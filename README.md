# 多视角数据体检 · Multiview Check

给小型多视角数据集做一次本地体检：图像、内参、位姿、编号和时间戳是否自洽？输出 JSON 与可离线打开的 HTML 报告。

[项目与合成示例](https://chenyueqi2024.github.io/multiview-check/) · [异常报告](https://chenyueqi2024.github.io/multiview-check/demo-report.html)

## 安装与使用

Python 3.10+。下载本仓库后：

```bash
python -m pip install .
multiview-check examples/healthy/dataset.json --output my-report
multiview-check examples/broken/dataset.json --output broken-report
```

也可以在仓库根目录运行 `python -m multiview_check ...`。报告为 `report.json` 和 `report.html`。工具不会修改输入文件。使用独立输出目录，不覆盖自己已有的同名报告。

退出码：0 无错误（默认允许警告）；1 检出错误或 `--strict` 下有警告；2 CLI 参数或输出写入失败。未读到清单会生成错误报告，退出 1。

## v1 数据格式

```json
{
  "schema_version": 1,
  "convention": "camera_to_world",
  "units": "m",
  "frames": [{
    "id": "frame_0", "image": "images/0.png", "width": 320, "height": 240,
    "K": [[260,0,160],[0,260,120],[0,0,1]],
    "pose": [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],
    "timestamp": 0.0
  }]
}
```

图像路径相对于清单目录，仅允许该目录内部（包含符号链接解析）。相机坐标为 +X 向右、+Y 向下、+Z 向前。`convention` 必须明确指定 `camera_to_world` 或 `world_to_camera`，工具不会猜测。位姿平移以 m 计；K 使用像素单位；可选 timestamp 使用秒。全部数值必须有限。

## 检查范围

- 清单结构、重复 ID、缺失/越界路径、不可解码图像、声明尺寸与实际尺寸。
- 内参矩阵形式与正焦距；主点越界作为警告。
- 位姿齐次行、旋转矩阵正交性与 det=+1，容差 1e-3。
- 相同文件引用、字节完全一致的图像、重复及逆序时间戳、目录内未引用图像。
- 通过位姿校验的相机中心和前向方向 XZ 投影，支持人工核对。

每张图最多读取 64 MiB，保留 Pillow 的解码像素安全限制；超限作为错误，不能当成已检查。报告不嵌入原图、不上传数据。图像内容哈希是精确字节重复检查，不是近重复检测。

v0.1 不做自动模糊度判断、坐标约定推断、COLMAP 原生读取或重建质量评分。轨迹只作为目视排查线索。建议后续先收集不同公开数据集的格式适配需求。

## 验证与样例

```bash
python -m unittest discover -s tests -v
python examples/build_samples.py
```

样例图片均为程序绘制的合成几何图形。`healthy` 应为零错误零警告；`broken` 故意注入尺寸错配、非正交旋转、重复图像、主点越界、时间逆序、缺失图片和未引用图片。测试还覆盖非平凡位姿变换、路径穿越、损坏图像和 HTML 转义。

MIT License · Yueqi
