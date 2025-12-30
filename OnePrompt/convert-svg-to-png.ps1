Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Xml.Linq

$svgPath = "icons/icon.svg"
$pngPath16 = "icons/icon16.png"
$pngPath48 = "icons/icon48.png"
$pngPath128 = "icons/icon128.png"

# 读取SVG内容
$svgContent = Get-Content -Path $svgPath -Raw

# 创建一个简单的PNG图标（使用纯色背景和简单图形）
function CreatePngIcon($outputPath, $size) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    
    # 绘制背景
    $backgroundBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(59, 130, 246))
    $graphics.FillRectangle($backgroundBrush, 0, 0, $size, $size)
    
    # 绘制文档图标
    $documentBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $documentX = $size * 0.28
    $documentY = $size * 0.22
    $documentWidth = $size * 0.4375
    $documentHeight = $size * 0.5625
    $documentRadius = $size * 0.046875
    
    [System.Drawing.Drawing2D.GraphicsPath]$path = New-Object System.Drawing.Drawing2D.GraphicsPath
    [System.Drawing.RectangleF]$rect = New-Object System.Drawing.RectangleF($documentX, $documentY, $documentWidth, $documentHeight)
    $path.AddArc($rect.X, $rect.Y, $documentRadius * 2, $documentRadius * 2, 180, 90)
    $path.AddArc($rect.X + $rect.Width - $documentRadius * 2, $rect.Y, $documentRadius * 2, $documentRadius * 2, 270, 90)
    $path.AddArc($rect.X + $rect.Width - $documentRadius * 2, $rect.Y + $rect.Height - $documentRadius * 2, $documentRadius * 2, $documentRadius * 2, 0, 90)
    $path.AddArc($rect.X, $rect.Y + $rect.Height - $documentRadius * 2, $documentRadius * 2, $documentRadius * 2, 90, 90)
    $path.CloseFigure()
    
    $graphics.FillPath($documentBrush, $path)
    
    # 绘制线条
    $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(59, 130, 246), $size * 0.0234375)
    $lineX1 = $size * 0.359375
    $lineY1 = $size * 0.34375
    $lineX2 = $size * 0.5625
    $lineY2 = $size * 0.34375
    $graphics.DrawLine($linePen, $lineX1, $lineY1, $lineX2, $lineY2)
    
    $lineY1 = $size * 0.4375
    $lineY2 = $size * 0.4375
    $lineX2 = $size * 0.640625
    $graphics.DrawLine($linePen, $lineX1, $lineY1, $lineX2, $lineY2)
    
    $lineY1 = $size * 0.53125
    $lineY2 = $size * 0.53125
    $graphics.DrawLine($linePen, $lineX1, $lineY1, $lineX2, $lineY2)
    
    $lineY1 = $size * 0.625
    $lineY2 = $size * 0.625
    $lineX2 = $size * 0.546875
    $graphics.DrawLine($linePen, $lineX1, $lineY1, $lineX2, $lineY2)
    
    # 保存PNG
    $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    
    # 清理资源
    $graphics.Dispose()
    $bitmap.Dispose()
    $backgroundBrush.Dispose()
    $documentBrush.Dispose()
    $linePen.Dispose()
    $path.Dispose()
}

# 创建不同尺寸的PNG图标
CreatePngIcon $pngPath16 16
CreatePngIcon $pngPath48 48
CreatePngIcon $pngPath128 128

Write-Host "PNG icons created successfully!"
