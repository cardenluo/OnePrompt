import { app } from '../../scripts/app.js';

app.registerExtension({
    name: 'apt.node_width_and_style',
    async beforeRegisterNodeDef(nodeType, nodeData) {
        const isAptPreset = nodeData.name && (
            nodeData.name.startsWith('file_') || 
            nodeData.name.startsWith('csv_')

        );

        if (isAptPreset) {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated?.apply(this, arguments);

                // 设置初始宽度为 260
                this.size[0] = 260;
                this.setSize([260, this.size[1]]);

                // 修改 computeSize 方法，确保宽度不小于 160
                const originalComputeSize = this.computeSize;
                this.computeSize = function () {
                    const size = originalComputeSize.call(this);
                    size[0] = Math.max(160, Math.min(500, size[0]));
                    return size;
                };


                return r;
            };
        }
        
    }
});
