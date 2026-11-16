import Uppy from "@uppy/core";
import {Plus} from 'lucide-react'
import {Button} from '../ui/Button'
import { useRef } from "react";

export function UploadButton({uppy}: {uppy: Uppy}) {

    const inputRef = useRef<HTMLInputElement | null>(null);

    return (
        <>
            <Button 
            variant='outline'
            onClick={()=>{
                if(inputRef.current){
                    inputRef.current.click();
                }
            }}>
            <Plus />
        </Button>
        <input
        ref={inputRef}
        type="file"
        multiple
        onChange={(e) => {
          if (e.target.files) {
            Array.from(e.target.files).forEach((file) => {
              // 直接传 File 实例，别包成 { data: file }。
              // addFile 签名是 (file: File | MinimalRequiredUppyFile)，
              // 传 File 时 Uppy 的 #transformFile 会自动提取 name / type / size；
              // 包成普通对象这三个字段全丢，name 会 fallback 成 "noname"
              // （见 @uppy/core 的 getFileName.js），
              // 于是 COS 对象键变成「日期/noname」，没有扩展名，浏览器打不开。
              uppy.addFile(file);
            });
          }
          // 清空 value，否则同一个文件第二次选不会触发 onChange
          // （浏览器认为 value 没变）。这是 file input 的经典坑。
          e.target.value = "";
        }}
        className="fixed left-[-10000px]"
      ></input>
        </>
    );
}