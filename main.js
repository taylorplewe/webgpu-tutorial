const canvasEl = document.querySelector('canvas');
if (!navigator.gpu) {
	throw new Error('WebGPU not supported in this browser!!');
}
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) {
	throw new Error("No appropriate GPUAdapter found.");
}
const device = await adapter.requestDevice();
if (!device) {
	throw new Error("No appropriate GPUDevice found.");
}

const context = canvasEl.getContext('webgpu');
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
context.configure({
	device: device,
	format: canvasFormat,
});

const GRID_SIZE = 64;
const WORKGROUP_SIZE = 8;
const vertices = new Float32Array([
//   X,    Y,
	-0.8, -0.8, // Triangle 1
	 0.8, -0.8,
	 0.8,  0.8,

	-0.8, -0.8, // Triangle 2
	 0.8,  0.8,
	-0.8,  0.8,
]);

const vertexBuffer = device.createBuffer({
	label: 'Cell vertices',
	size: vertices.byteLength,
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/0, vertices);
const uniformArray = new Float32Array([GRID_SIZE, GRID_SIZE]);
const uniformBuffer = device.createBuffer({
	label: 'Grid uniforms',
	size: uniformArray.byteLength,
	usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

const cellStateArray = new Uint32Array(GRID_SIZE * GRID_SIZE);
const cellStateStorage = [
	device.createBuffer({
		label: "Cell State",
		size: cellStateArray.byteLength,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	}),
	device.createBuffer({
		label: "Cell State",
		size: cellStateArray.byteLength,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	}),
];
for (let i = 0; i < cellStateArray.length; i++) {
	cellStateArray[i] = Math.random() > 0.6 ? 1 : 0;
}
device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);
device.queue.writeBuffer(cellStateStorage[1], 0, cellStateArray);

const vertexBufferLayout = {
	arrayStride: 8,
	attributes: [{
		format: 'float32x2',
		offset: 0,
		shaderLocation: 0, // position, see vertex shader
	}],
};
const cellShaderModule = device.createShaderModule({
	label: 'Cell shader',
	code: `
		struct VertexInput  {
			@location(0) pos: vec2f,
			@builtin(instance_index) instance: u32,
		}
		struct VertexOutput {
			@builtin(position) pos: vec4f,
			@location(0) cell: vec2f,
		}
		@group(0) @binding(0) var<uniform> gridSize: vec2f;
		@group(0) @binding(1) var<storage> cellStateIn: array<u32>;
		@group(0) @binding(2) var<storage, read_write> cellStateOut: array<u32>;

		@vertex
		fn vertexMain(in: VertexInput) -> VertexOutput {
			let i = f32(in.instance);
			let cellPos = vec2f(i % gridSize.x, floor(i / gridSize.x));
			let cellOffset = (cellPos / gridSize) * 2;
			let state = f32(cellStateIn[in.instance]);
			let gridPos = (((in.pos*state + 1) / gridSize) - 1) + cellOffset;

			var out: VertexOutput;
			out.pos = vec4f(gridPos, 0, 1); // (x, y, z, w)
			out.cell = cellPos;
			return out;
		}

		@fragment
		fn fragmentMain(in: VertexOutput) -> @location(0) vec4<f32> {
			let c = in.cell/gridSize;
			return vec4<f32>(c, 1-c.x, 1.0);
		}
	`
});
const simulationShaderModule = device.createShaderModule({
	label: "Simulation shader",
	code: `
		@group(0) @binding(0) var<uniform> gridSize: vec2f;
		@group(0) @binding(1) var<storage> cellStateIn: array<u32>;
		@group(0) @binding(2) var<storage, read_write> cellStateOut: array<u32>;

		fn cellIndex(cell: vec2u) -> u32 {
			return (cell.y % u32(gridSize.y)) * u32(gridSize.x) +
				(cell.x % u32(gridSize.x));
		}
		fn cellActive(x: u32, y: u32) -> u32 {
				return cellStateIn[cellIndex(vec2(x, y))];
		}

		@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
		fn computeMain(@builtin(global_invocation_id) cell: vec3u) {
			// Determine how many active neighbors this cell has.
				let activeNeighbors = cellActive(cell.x+1, cell.y+1) +
				cellActive(cell.x+1, cell.y) +
				cellActive(cell.x+1, cell.y-1) +
				cellActive(cell.x, cell.y-1) +
				cellActive(cell.x-1, cell.y-1) +
				cellActive(cell.x-1, cell.y) +
				cellActive(cell.x-1, cell.y+1) +
				cellActive(cell.x, cell.y+1);
				let i = cellIndex(cell.xy);

			// Conway's game of life rules:
			switch activeNeighbors {
			case 2: { // Active cells with 2 neighbors stay active.
				cellStateOut[i] = cellStateIn[i];
			}
			case 3: { // Cells with 3 neighbors become or stay active.
				cellStateOut[i] = 1;
			}
			default: { // Cells with < 2 or > 3 neighbors become inactive.
				cellStateOut[i] = 0;
			}
			}
		}
	`,
});
const bindGroupLayout = device.createBindGroupLayout({
	label: "Cell Bind Group Layout",
	entries: [{
		binding: 0,
		// Add GPUShaderStage.FRAGMENT here if you are using the `grid` uniform in the fragment shader.
		visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
		buffer: {} // Grid uniform buffer
	}, {
		binding: 1,
		visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
		buffer: { type: "read-only-storage"} // Cell state input buffer
	}, {
		binding: 2,
		visibility: GPUShaderStage.COMPUTE,
		buffer: { type: "storage"} // Cell state output buffer
	}]
});
const pipelineLayout = device.createPipelineLayout({
	label: "Cell Pipeline Layout",
	bindGroupLayouts: [ bindGroupLayout ],
});
const cellPipeline = device.createRenderPipeline({
	label: 'Cell pipeline',
	layout: pipelineLayout,
	vertex: {
		module: cellShaderModule,
		entryPoint: 'vertexMain',
		buffers: [vertexBufferLayout],
	},
	fragment: {
		module: cellShaderModule,
		entryPoint: 'fragmentMain',
		targets: [{
			format: canvasFormat,
		}],
	},
});
const simulationPipeline = device.createComputePipeline({
	label: "Simulation pipeline",
	layout: pipelineLayout,
	compute: {
		module: simulationShaderModule,
		entryPoint: "computeMain",
	}
});

const bindGroups = [
	device.createBindGroup({
		label: 'Cell renderer bind group',
		layout: bindGroupLayout,
		entries: [{
			binding: 0,
			resource: { buffer: uniformBuffer }
		}, {
			binding: 1,
			resource: { buffer: cellStateStorage[0] }
		}, {
			binding: 2, // New Entry
			resource: { buffer: cellStateStorage[1] }
		}],
	}),
	device.createBindGroup({
		label: 'Cell renderer bind group',
		layout: bindGroupLayout,
		entries: [{
			binding: 0,
			resource: { buffer: uniformBuffer }
		}, {
			binding: 1,
			resource: { buffer: cellStateStorage[1] }
		}, {
			binding: 2,
			resource: { buffer: cellStateStorage[0] }
		}],
	}),
];

const UPDATE_INTERVAL = 20;
let step = 0;
const update = () => {
	const encoder = device.createCommandEncoder();
	const computePass = encoder.beginComputePass();
	computePass.setPipeline(simulationPipeline);
	computePass.setBindGroup(0, bindGroups[step % 2]);
	const workgroupCount = Math.ceil(GRID_SIZE / WORKGROUP_SIZE);
	computePass.dispatchWorkgroups(workgroupCount, workgroupCount);
	computePass.end();
	const pass = encoder.beginRenderPass({
		colorAttachments: [{
			view: context.getCurrentTexture().createView(),
			loadOp: 'clear',
			clearValue: { r: 0.2, g: 0.2, b: 0.2, a: 1 },
			storeOp: 'store',
		}]
	});

	pass.setPipeline(cellPipeline);
	pass.setVertexBuffer(0, vertexBuffer);
	pass.setBindGroup(0, bindGroups[step % 2]);
	pass.draw(vertices.length / 2, GRID_SIZE * GRID_SIZE);

	pass.end();
	device.queue.submit([encoder.finish()]);

	step++;
}
setInterval(update, UPDATE_INTERVAL);