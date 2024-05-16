const canvasEl = document.querySelector('canvas');
if (!navigator.gpu) {
	throw new Error('WebGPU not supported in this browser!!');
}
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) {
  throw new Error("No appropriate GPUAdapter found.");
}