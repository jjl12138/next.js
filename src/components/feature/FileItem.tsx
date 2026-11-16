export function FileItem({ contentType, id, name }: { contentType: string, id: string, name: string }) {
    const isImage = contentType.startsWith("image");
    return isImage ? (
        <img
            src={`/image/${id}`}
            alt={name}
            loading="lazy"
            className="h-56 w-full bg-gray-50 object-contain"
        />
    ) : (
        // 用原生 img 而不是 next/image：next/image 的优化器默认拒绝 SVG
        // （要开 images.dangerouslyAllowSVG 才放行，本地小图标没必要走优化）。
        <img
            src="/unknown-file-types.svg"
            alt="未知文件类型"
            className="h-56 w-full bg-gray-50 object-contain p-10"
        />
    )
}