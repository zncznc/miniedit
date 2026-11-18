// exe 的图标与版本信息：GNU 工具链下走 windres，不需要 MSVC。
fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let mut res = winresource::WindowsResource::new();
    res.set_icon("../build/icon.ico");
    res.set("ProductName", "MiniEdit");
    res.set("FileDescription", "MiniEdit 代码编辑器");
    res.set("LegalCopyright", "MiniEdit");
    res.compile().expect("资源编译失败（需要 windres）");
}
