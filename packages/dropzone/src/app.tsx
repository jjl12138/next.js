import { Dropzone } from '../lib/Dropzone'

export function App() {
  return (
    <>
      {/* Dropzone 的 onDraggingChange / onFileChosen 都是必填 prop */}
      <Dropzone
        onDraggingChange={(dragging) => console.log('拖拽中:', dragging)}
        onFileChosen={(files) => console.log('选中文件:', files)}
      >
        <p className="flex h-40 items-center justify-center text-sm text-gray-500">
          把文件拖到这里
        </p>
      </Dropzone>
    </>
  )
}
