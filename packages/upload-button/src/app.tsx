import { UploadButton } from '../lib/UploadButton'

export function App() {
  return (
    <>
      {/* onFileChosen 现在是可选 prop：不传不会报错，只是选了文件没人处理 */}
      <UploadButton onFileChosen={(files) => console.log('选中文件:', files)} />
    </>
  )
}
