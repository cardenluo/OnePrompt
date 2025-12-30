# 图标说明

由于无法直接生成PNG文件,请按以下方式创建图标:

## 方法1: 使用在线工具转换SVG

1. 打开 `icon.svg` 文件
2. 访问在线转换工具,如: https://convertio.co/zh/svg-png/
3. 上传 `icon.svg` 文件
4. 分别生成以下尺寸的PNG图片:
   - icon16.png (16x16)
   - icon48.png (48x48)
   - icon128.png (128x128)

## 方法2: 使用Photoshop/GIMP

1. 打开 `icon.svg` 文件
2. 分别导出为不同尺寸的PNG

## 方法3: 临时方案

如果暂时无法生成PNG,可以先注释掉 `manifest.json` 中的 icons 部分:

```json
// "icons": {
//   "16": "icons/icon16.png",
//   "48": "icons/icon48.png",
//   "128": "icons/icon128.png"
// }
```

插件仍然可以正常工作,只是没有图标显示。
