# Draws Prumo's app icons (plumb bob on the school navy) into web/assets.
# Run from the repo root:  powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\web\assets'
$navy = [System.Drawing.Color]::FromArgb(255, 0, 53, 130)
$coral = [System.Drawing.Color]::FromArgb(255, 229, 80, 44)
$white = [System.Drawing.Color]::White

function Draw-Icon([int]$size, [string]$name, [bool]$rounded, [double]$scale) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $bg = New-Object System.Drawing.SolidBrush($navy)
  if ($rounded) {
    $r = [int]($size * 0.22)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90)
    $path.AddArc($size - 2 * $r, 0, 2 * $r, 2 * $r, 270, 90)
    $path.AddArc($size - 2 * $r, $size - 2 * $r, 2 * $r, 2 * $r, 0, 90)
    $path.AddArc(0, $size - 2 * $r, 2 * $r, 2 * $r, 90, 90)
    $path.CloseFigure()
    $g.FillPath($bg, $path)
  } else {
    $g.FillRectangle($bg, 0, 0, $size, $size)
  }
  # the bob, drawn inside a centred box of $scale * size (maskable icons need a safe zone)
  $b = $size * $scale
  $ox = ($size - $b) / 2
  $oy = ($size - $b) / 2
  $line = New-Object System.Drawing.Pen($white, [single]($b * 0.065))
  $line.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $line.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($line, [single]($ox + $b * 0.5), [single]($oy + $b * 0.12), [single]($ox + $b * 0.5), [single]($oy + $b * 0.34))
  $tri = New-Object System.Drawing.Drawing2D.GraphicsPath
  $pts = @(
    (New-Object System.Drawing.PointF([single]($ox + $b * 0.30), [single]($oy + $b * 0.42))),
    (New-Object System.Drawing.PointF([single]($ox + $b * 0.70), [single]($oy + $b * 0.42))),
    (New-Object System.Drawing.PointF([single]($ox + $b * 0.50), [single]($oy + $b * 0.88)))
  )
  $tri.AddPolygon($pts)
  $fill = New-Object System.Drawing.SolidBrush($coral)
  $edge = New-Object System.Drawing.Pen($coral, [single]($b * 0.06))
  $edge.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.FillPath($fill, $tri)
  $g.DrawPath($edge, $tri)
  $g.Dispose()
  $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

Draw-Icon 192 'icon-192.png' $true 0.86
Draw-Icon 512 'icon-512.png' $true 0.86
Draw-Icon 512 'icon-maskable-512.png' $false 0.66
Draw-Icon 180 'apple-touch-icon.png' $false 0.8
Get-ChildItem $out -Filter '*icon*' | Select-Object Name, Length
