import './style.css';
import * as d3 from 'd3';
import Graph from './graph.ts';

const graph = new Graph('#app');

graph.data = await d3.json('./miserables.json');

graph.init().then(() => {
  graph.draw();
});
