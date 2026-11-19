# 多视角数据体检 · Multiview Check

给小型多视角数据集做一次本地体检：图像、内参、位姿、编号和时间戳是否自洽？可直接在浏览器内选择文件，也可继续使用 Python 命令行。输出 JSON 与可离线打开的 HTML 报告。

[项目与合成示例](https://chenyueqi2024.github.io/multiview-check/) · [异常报告](https://chenyueqi2024.github.io/multiview-check/demo-report.html)

## 浏览器版 v0.2

打开网站，无需安装、账号或 API。选择包含 JSON 清单与图像的整个文件夹；存在多份清单时在下拉框中选择。也可分别选择清单与多张图像。然后点击“开始本机检查”，查看问题清单、筛选错误/警告、查看 XZ 相机轨迹，下载 HTML/JSON 报告。

- 文件夹模式保留相对路径，只检查所选清单目录下的图像。
- 单独选图模式可以按唯一文件名匹配，但会提示未核验目录关系；清单里不同路径的同名文件、所选文件同名冲突均报错，不猜测。
- 支持 PNG/JPEG/WebP；最多 500 个图像文件、合计 256 MiB、单图 64 MiB / 2400 万像素、清单 5 MiB / 2000 帧。超限明确提示未检查。
- 图像编码尺寸先于解码读取；浏览器解码成功后做 SHA-256 精确字节重复检查。以文件编码的宽高核对清单，不将 EXIF 显示旋转当作重新标定。
- 仅处理所选文件，不扫描磁盘、解析 ZIP、解析符号链接或推断坐标约定。浏览器对损坏图片的容忍度可能与 Pillow 不同，不能声称两个解码器完全等价。
- 浏览器路径规则拒绝任何 `..` 段；单独选图不能证明原始目录结构。JSON 数值按 JavaScript 浮点数解析，尺寸还要求安全整数。
- 可取消或清空；取消会丢弃本次结果，正在执行的一张图片解码结束后不再继续。更换输入会隐藏旧报告，避免把上次结果当成本次结果。

所有文件在页面内存中处理，不发起上传，不写入 localStorage/IndexedDB。页面加载需要读取公开静态资源；内置合成样例随页面模块加载。页面用 CSP `connect-src 'none'` 阻止连接类请求，不依赖外部库、CDN 或统计脚本。主动下载的报告包含帧名但不嵌入原图，分享前应自行核对。

本地预览：在仓库根目录运行 `python -m http.server 8000 --directory docs`，打开 `http://localhost:8000`。使用 HTTPS 或 localhost，以支持浏览器加密哈希接口；不要直接双击 HTML 文件运行 ES 模块。

Python 工具保留 v0.1 命令与功能；不需要运行浏览器版即可使用。

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

两个版本均不做自动模糊度判断、坐标约定推断、COLMAP 原生读取或重建质量评分。轨迹只作为目视排查线索。

## 验证与样例

```bash
python -m unittest discover -s tests -v
python examples/build_samples.py
npm test
```

样例图片均为程序绘制的合成几何图形。`healthy` 应为零错误零警告；`broken` 故意注入尺寸错配、非正交旋转、重复图像、主点越界、时间逆序、缺失图片和未引用图片。测试还覆盖非平凡位姿变换、路径穿越、损坏图像和 HTML 转义。

浏览器规则测试要求 Node 22，比较相对路径模式下两端样例的规则、级别、帧和相机数据：异常样例均为 3 个错误、5 条警告。发布前另在浏览器中验证四种屏宽、目录与单独文件选择、实际 PNG/JPEG/WebP 解码、错误与超限、下载、取消及清空；加载后断网仍可运行，文件操作期间没有新网络请求。未对大型真实数据集做性能或兼容性评估。

MIT License · Yueqi
