import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

function buildViewURL(file) {
	const params = new URLSearchParams({
		filename: file.filename,
		type: file.type || "output",
	});
	if (file.subfolder) params.set("subfolder", file.subfolder);
	return api.apiURL("/view?" + params.toString());
}

app.registerExtension({
	name: "APT.AnyFileToZip",
	async beforeRegisterNodeDef(nodeType, nodeData) {
		if (nodeData.name === "file_LoadZipFile") {
			const onNodeCreated = nodeType.prototype.onNodeCreated;
			nodeType.prototype.onNodeCreated = function () {
				if (onNodeCreated) onNodeCreated.apply(this, arguments);

				const zipWidget = this.widgets?.find((w) => w.name === "zip_file");
				if (!zipWidget) return;
				zipWidget.label = "ZIP文件";

				const fileUploadWidgets = (this.widgets || []).filter((w) => w?.type === "button" && w?.name === "上传ZIP文件");
				if (fileUploadWidgets.length > 0) {
					const keep = fileUploadWidgets[0];
					keep.__aptZipFileUploadToInput = true;
					this.widgets = (this.widgets || []).filter((w) => w === keep || !(w?.type === "button" && w?.name === "上传ZIP文件"));
				}
				let input = this._aptZipFileUploadToInputInput;
				if (!input) {
					input = document.createElement("input");
					input.type = "file";
					input.accept = ".zip,application/zip";
					input.style.display = "none";
					document.body.appendChild(input);
					this._aptZipFileUploadToInputInput = input;
				}


				input.onchange = async () => {
					try {
						const f = input.files?.[0];
						if (!f) return;

						// 检查文件扩展名是否为 .zip
						if (!f.name.toLowerCase().endsWith('.zip')) {
							alert("只能上传 ZIP 文件！");
							return;
						}

						const form = new FormData();
						form.append("image", f, f.name);
						form.append("type", "input");
						form.append("overwrite", "true");
						const resp = await api.fetchApi("/upload/image", {
							method: "POST",
							body: form,
						});
						if (!resp.ok) {
							throw new Error(`上传失败: ${resp.status}`);
						}
						const res = await resp.json();

						// 将相对路径显示在 zip_file 选择框中，并更新选项列表
						const uploadedPath = res.subfolder ? `${res.subfolder}/${res.name}` : res.name;
						
						// 更新 zip_file 的选项列表
						if (zipWidget.options?.values && !zipWidget.options.values.includes(uploadedPath)) {
							zipWidget.options.values.push(uploadedPath);
							zipWidget.options.values.sort();
						}
						
						zipWidget.value = uploadedPath;
						app.graph.setDirtyCanvas(true, true);
					} catch (e) {
						console.error("上传文件失败:", e);
						alert("上传文件失败: " + e.message);
					} finally {
						input.value = "";
					}
				};

				let fileUploadButton = (this.widgets || []).find((w) => w?.__aptZipFileUploadToInput === true);
				if (!fileUploadButton) {
					fileUploadButton = this.addWidget("button", "上传ZIP文件", null, () => input.click(), { serialize: false });
					fileUploadButton.__aptZipFileUploadToInput = true;
				}
			};
		}

		if (nodeData.name === "file_AnyFileToZip") {
			const onNodeCreated = nodeType.prototype.onNodeCreated;
			nodeType.prototype.onNodeCreated = function () {
				if (onNodeCreated) onNodeCreated.apply(this, arguments);

				const prefixWidget = this.widgets?.find((w) => w.name === "filename_prefix");
				if (prefixWidget) prefixWidget.label = "文件名前缀";
			};

			nodeType.prototype.onExecuted = function (message) {
				const file = message?.zip?.[0] || message?.images?.[0];
				if (!file) return;

				const url = buildViewURL(file);
				this._APTZipDownloadUrl = url;

				const downloadWidgets = (this.widgets || []).filter((w) => w?.type === "button" && w?.name === "下载ZIP");
				if (downloadWidgets.length > 0) {
					const keep = downloadWidgets[0];
					keep.__APTZipDownload = true;
					this.widgets = (this.widgets || []).filter((w) => w === keep || !(w?.type === "button" && w?.name === "下载ZIP"));
				}

				let downloadButton = (this.widgets || []).find((w) => w?.__APTZipDownload === true);
				if (!downloadButton) {
					downloadButton = this.addWidget(
						"button",
						"下载ZIP",
						null,
						() => {
							const u = this._APTZipDownloadUrl;
							if (u) window.open(u, "_blank", "noopener,noreferrer");
						},
						{ serialize: false }
					);
					downloadButton.__APTZipDownload = true;
				}
				app.graph.setDirtyCanvas(true, true);
			};
		}
	},
});