import './style.css';
import * as d3 from 'd3';
import Graph, { miserables } from './graph.ts';

const graph = new Graph('#app');
const data = await d3.json<miserables>('./miserables.json');

graph.data = data;

graph.init().then(() => {
  graph.draw();
});

document
  .getElementById('multiplyer')
  ?.addEventListener('change', function (this: HTMLSelectElement) {
    const m = +this.value;
    const new_nodes: any = [];
    const new_links: any = [];
    for (var i = 0; i < m; i++) {
      data?.nodes.forEach((node) => {
        new_nodes.push({ id: `${node.id}_${i}`, group: node.group });
      });
      data?.links.forEach((link) => {
        new_links.push({
          source: `${link.source}_${i}`,
          target: `${link.target}_${i}`,
          value: link.value,
        });
      });
    }
    graph.data = {
      nodes: new_nodes,
      links: new_links,
    };
    graph.draw();
  });
