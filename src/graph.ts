import * as d3 from 'd3';
import * as PIXI from 'pixi.js';

interface node {
  id: string;
  group: number;
}

interface link {
  source: string;
  target: string;
  value: number;
}

export interface miserables {
  nodes: node[];
  links: link[];
}

interface simnode extends node, d3.SimulationNodeDatum {
  gfx?: PIXI.Container | null;
  x: number;
  y: number;
  selected: boolean;
  color: PIXI.ColorSource;
}

type simlink = d3.SimulationLinkDatum<simnode>;

const FONTSIZE = 5;
const NODESIZE = 3;
const LINEWIDTH = 1;
const STROKEWIDTH = 1;
const CLICKDELAY = 200;

export default class Graph {
  data: miserables | undefined;
  nodes: simnode[] = [];
  links: simlink[] = [];
  private width = 1024;
  private height = 768;
  private currentNode: simnode | null = null;
  private selected = new Set<string>();
  private clickTimestamp = 0;

  private canvas;
  private app;
  private spr_bg;
  private spr_select;
  private gfx_link;
  private c_zoom;
  private c_nodes;

  private svg;
  private g_zoom;
  private g_nozoom;
  private axis;
  private zoom;
  private simulation;

  constructor(selector: string) {
    const container = d3
      .select<HTMLElement, undefined>(selector)
      .style('max-width', `${this.width}px`);
    this.canvas = container
      .append(() => document.createElement('canvas'))
      .style('max-width', `${this.width}px`)
      .style('position', 'absolute')
      .style('top', 0)
      .style('left', 0)
      .style('z-index', 0);
    this.svg = container
      .append('svg')
      .attr('viewBox', [0, 0, this.width, this.height])
      .style('border', 'black solid 1px')
      .style('pointer-events', 'none')
      .style('position', 'relative')
      .style('width', '100%')
      .style('top', 0)
      .style('left', 0)
      .style('z-index', 1);

    // D3 members
    this.g_zoom = this.svg.append('g');
    this.g_nozoom = this.svg.append('g');

    this.axis = this.createAxis(this.g_nozoom);

    this.zoom = d3
      .zoom<HTMLCanvasElement, undefined>()
      .filter(
        (event) =>
          (event.button === 0 &&
            !event.shiftKey &&
            this.currentNode === null) ||
          event.type === 'wheel'
      )
      .on('zoom', this.zoomed);

    this.simulation = d3
      .forceSimulation<simnode, simlink>()
      .force('charge', d3.forceManyBody())
      .force('link', d3.forceLink())
      .force('x', d3.forceX().strength(0.05))
      .force('y', d3.forceY().strength(0.05));

    // PIXI members
    this.app = new PIXI.Application();
    this.spr_bg = this.app.stage.addChild(new PIXI.Sprite(PIXI.Texture.WHITE));
    this.c_zoom = this.app.stage.addChild(new PIXI.Container());
    this.gfx_link = this.c_zoom.addChild(new PIXI.Graphics());
    this.c_nodes = this.c_zoom.addChild(new PIXI.Container());
    this.spr_select = this.c_zoom.addChild(new PIXI.Sprite(PIXI.Texture.WHITE));

    this.canvas
      .call(this.zoom)
      .call(this.dragged())
      .on('contextmenu', (event: MouseEvent) => {
        if (!event.shiftKey) event.preventDefault();
      })
      .on('pointerdown', () => {
        this.clickTimestamp = new Date().getTime();
      })
      .on('pointerup', () => {
        this.clickTimestamp = 0;
      })
      .on('pointerenter', () => {
        this.clickTimestamp = 0;
      });

    this.spr_bg
      .on('pointerup', (event: PIXI.FederatedPointerEvent) => {
        if (!event.shiftKey && this.isSingleClick) {
          this.selected = new Set();
          this.drawSelection();
          this.clicked(event, null);
        }
      })
      .on('pointermove', () => {
        if (this.currentNode && !this.clickTimestamp) {
          this.currentNode = null;
          this.setHover();
        }
      });
  }

  async init() {
    return this.app
      .init({
        width: this.width,
        height: this.height,
        antialias: true,
        autoDensity: true,
        autoStart: false,
        resolution: 2,
        canvas: this.canvas.node()!,
      })
      .then(() => {
        this.canvas.style('width', '100%').style('height', null);
        this.spr_bg.width = this.app.screen.width;
        this.spr_bg.height = this.app.screen.height;
        this.spr_bg.eventMode = 'static';
        this.spr_bg.tint = 0xffffee;
        this.spr_select.tint = 0x888888;
        this.spr_select.alpha = 0.3;
        this.spr_select.visible = false;
        this.spr_select.width = 5;
        this.spr_select.height = 5;
        this.resetView();
      });
  }

  zoomed = (evt: d3.D3ZoomEvent<HTMLCanvasElement, undefined>) => {
    this.axis.zoomed(evt);
    if (this.c_zoom.scale.x === evt.transform.k) {
      this.g_zoom.attr('transform', evt.transform.toString());
      this.c_zoom.position.x = evt.transform.x;
      this.c_zoom.position.y = evt.transform.y;
      this.app.render();
    } else {
      const ix = d3.interpolate(this.c_zoom.position.x, evt.transform.x);
      const iy = d3.interpolate(this.c_zoom.position.y, evt.transform.y);
      const ik = d3.interpolate(this.c_zoom.scale.x, evt.transform.k);
      this.canvas
        .transition()
        .delay(0)
        .duration(200)
        .ease(d3.easeLinear)
        .tween('zoom', () => (t) => {
          if (t === 1) {
            this.g_zoom.attr('transform', evt.transform.toString());
            this.c_zoom.position.x = evt.transform.x;
            this.c_zoom.position.y = evt.transform.y;
            this.c_zoom.scale.x = evt.transform.k;
            this.c_zoom.scale.y = evt.transform.k;
          } else {
            this.g_zoom.attr(
              'transform',
              `translate(${ix(t)}, ${iy(t)}) scale(${(ik(t), ik(t))})`
            );
            this.c_zoom.position.x = ix(t);
            this.c_zoom.position.y = iy(t);
            this.c_zoom.scale.x = ik(t);
            this.c_zoom.scale.y = ik(t);
          }
          this.app.render();
        });
    }
  };

  dragged = () => {
    let restartFlag = false;
    let select: string[] = [];
    const brush = { x: 0, y: 0, fx: 0, fy: 0 };
    const dragstarted = (
      event: d3.D3DragEvent<Element, undefined, simnode>
    ) => {
      if (event.subject === brush) {
        const local = this.c_zoom.toLocal(
          this.getPointerPosition(event.sourceEvent)
        );
        brush.x = local.x;
        brush.y = local.y;
        restartFlag = false;
        select = [];
      } else {
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
        if (!event.active) restartFlag = true;
      }
    };

    const dragging = (event: d3.D3DragEvent<Element, undefined, simnode>) => {
      if (restartFlag) {
        this.simulation.alphaTarget(0.3).restart();
        restartFlag = false;
      }
      const local = this.c_zoom.toLocal(
        this.getPointerPosition(event.sourceEvent)
      );
      event.subject.fx! = local.x;
      event.subject.fy! = local.y;
      if (event.subject === brush) {
        this.spr_select.visible = true;
        const x0 = Math.min(brush.x, brush.fx);
        const x1 = Math.max(brush.x, brush.fx);
        const y0 = Math.min(brush.y, brush.fy);
        const y1 = Math.max(brush.y, brush.fy);

        this.spr_select.x = x0;
        this.spr_select.y = y0;
        this.spr_select.width = x1 - x0;
        this.spr_select.height = y1 - y0;

        select = this.nodes
          .filter((d) => x0 <= d.x && d.x <= x1 && y0 <= d.y && d.y <= y1)
          .map((d) => d.id);
        this.drawSelection(select);
      }
    };

    const dragended = (event: d3.D3DragEvent<Element, undefined, simnode>) => {
      if (!event.active) this.simulation.alphaTarget(0);
      this.spr_select.visible = false;
      event.subject.fx = null;
      event.subject.fy = null;
      if (event.subject === brush) {
        select.forEach((d) => this.selected.add(d));
        this.drawSelection();
      }
    };

    return d3
      .drag<HTMLCanvasElement, undefined>()
      .subject(() => this.currentNode ?? brush)
      .on('start', dragstarted)
      .on('drag', dragging)
      .on('end', dragended);
  };

  ticked = () => {
    this.nodes.forEach((node) => {
      const { x, y, gfx } = node;
      if (gfx) {
        gfx.position = { x: x ?? 0, y: y ?? 0 };
      }
    });

    this.gfx_link.clear();
    this.gfx_link.alpha = 0.6;
    this.links.forEach((link) => {
      const { source, target } = link;
      this.gfx_link.moveTo((source as any).x ?? 0, (source as any).y ?? 0);
      this.gfx_link.lineTo((target as any).x ?? 0, (target as any).y ?? 0);
      this.gfx_link.stroke({ width: LINEWIDTH, color: 0x888888 });
    });
    this.app.render();
  };

  clicked = (event: PIXI.FederatedPointerEvent, node: simnode | null) => {
    console.log('clicked', event, node);
  };

  hovered = (event: PIXI.FederatedPointerEvent, node: simnode | null) => {
    console.log('hovered', event, node);
  };

  setHover(hovered: simnode[] = []) {
    this.nodes.forEach((node) => {
      if (!!node.gfx) {
        node.gfx.tint = 0xffffff;
        node.gfx.alpha = 1;
      }
    });
    hovered.forEach((node) => {
      if (!!node.gfx) {
        node.gfx.tint = 0xcccccc;
        node.gfx.alpha = 0.5;
      }
    });
  }

  private createAxis(group: d3.Selection<SVGGElement, undefined, any, any>) {
    const label_x = group
      .append('text')
      .attr('x', this.width - 5)
      .attr('y', this.height - 30)
      .attr('text-anchor', 'end')
      .text('Axis X');
    const label_y = group
      .append('text')
      .attr('x', 30)
      .attr('y', 5)
      .attr('dominant-baseline', 'hanging')
      .text('Axis Y');
    const xAxis = d3.scaleLinear().domain([0, 2]).range([0, this.width]);
    const yAxis = d3
      .scaleLinear()
      .domain([(-2 * this.height) / this.width, 0])
      .range([this.height, 0]);
    const g_x = group
      .append('g')
      .attr('transform', `translate(0,${this.height})`);
    const g_y = group.append('g');
    return {
      label_x,
      label_y,
      zoomed: (event: d3.D3ZoomEvent<any, any>) => {
        g_x.call(d3.axisTop(event.transform.rescaleX(xAxis)).ticks(12));
        g_y.call(
          d3
            .axisRight(event.transform.rescaleY(yAxis))
            .ticks((12 * this.height) / this.width)
        );
      },
    };
  }

  getPointerPosition(event: MouseEvent) {
    const rect = this.canvas.node()!.getBoundingClientRect();
    const x = ((event.clientX - rect.left) * this.width) / rect.width;
    const y = ((event.clientY - rect.top) * this.height) / rect.height;
    return { x, y };
  }

  get isSingleClick() {
    return new Date().getTime() - this.clickTimestamp < CLICKDELAY;
  }

  drawNodePixi(node: simnode) {
    node.x = node.x ?? 0;
    node.y = node.y ?? 0;
    node.color = node.color ?? 0x888888;
    node.gfx = node.gfx ?? new PIXI.Container();
    node.gfx.eventMode = 'dynamic';
    node.gfx.cursor = 'pointer';
    node.gfx.zIndex = 1;
    node.gfx.tint = 0xffffff;
    node.gfx.alpha = 1;
    node.gfx.position = { x: node.x, y: node.y };
    node.gfx.removeChildren();
    this.drawNodeMarkerPixi(node);
    node.gfx.addChild(
      new PIXI.Text({
        text: node.id,
        anchor: 0.5,
        resolution: 4,
        style: {
          fontSize: FONTSIZE,
        },
      })
    );
    this.c_nodes.addChild(node.gfx);

    node.gfx
      .on('click', (event: PIXI.FederatedPointerEvent) => {
        if (this.isSingleClick) {
          if (event.shiftKey) {
            if (!this.selected.delete(node.id)) this.selected.add(node.id);
          } else {
            this.selected = new Set([node.id]);
          }
          this.drawSelection();
          this.clicked(event, node);
        }
      })
      .on('pointerdown', () => {
        node.gfx!.zIndex = 2;
      })
      .on('pointerup', () => {
        node.gfx!.zIndex = 1;
      })
      .on('pointerover', (event: PIXI.FederatedPointerEvent) => {
        if (!this.clickTimestamp) {
          this.currentNode = node;
          this.setHover([this.currentNode]);
          this.app.render();
          this.hovered(event, node);
        }
      })
      .on('pointerout', (event: PIXI.FederatedPointerEvent) => {
        if (!this.clickTimestamp) {
          if (this.currentNode === node) this.currentNode = null;
          this.setHover();
          this.app.render();
          this.hovered(event, null);
        }
      });
    // .on('rightclick', (event) => {
    //   this.rightclicked(event, node);
    // });
  }

  drawNodeMarkerPixi(node: simnode) {
    const marker =
      node.gfx!.getChildByLabel('marker') ??
      node.gfx!.addChild(new PIXI.Graphics({ label: 'marker' }));
    return (marker as PIXI.Graphics)
      .circle(0, 0, NODESIZE)
      .fill({ color: node.color })
      .stroke({ color: node.selected ? 'blue' : 'white', width: STROKEWIDTH });
  }

  drawSelection(preview?: Iterable<string>) {
    const previewSet = new Set(preview);
    this.selected.forEach((d) => previewSet.add(d));

    this.nodes.forEach((node) => {
      node.selected = previewSet.has(node.id);
      const marker = node.gfx?.getChildByLabel('marker');
      if (marker instanceof PIXI.Graphics) {
        marker.clear();
        this.drawNodeMarkerPixi(node);
      }
    });

    this.app.render();
  }

  draw() {
    const color = d3.scaleOrdinal(d3.schemeCategory10);
    this.nodes =
      this.data?.nodes.map((node) =>
        Object.assign({ x: 0, y: 0, color: 0, selected: false }, node)
      ) ?? [];
    this.links = this.data?.links.map((link) => Object.assign({}, link)) ?? [];
    this.nodes.forEach((node) => (node.gfx = null));
    this.c_nodes.children.map((c) => c.destroy());
    this.c_nodes.removeChildren();
    this.nodes.forEach((node) => {
      node.color = color('' + node.group);
      node.gfx = new PIXI.Container();
      this.drawNodePixi(node);
    });

    this.simulation
      .alpha(1)
      .restart()
      .nodes(this.nodes)
      .on('tick', this.ticked)
      .force<d3.ForceLink<simnode, simlink>>('link')
      ?.id((n) => n.id)
      .links(this.links);

    this.app.render();
  }

  resetView() {
    this.canvas.call(
      this.zoom.transform,
      new d3.ZoomTransform(1, this.width / 2, this.height / 2),
      [this.width / 2, this.height / 2]
    );
  }
}
