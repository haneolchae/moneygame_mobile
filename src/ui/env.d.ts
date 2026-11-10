// 화면 번들에서 CSS를 import할 수 있게 한다 (vite가 처리).
declare module '*.css';
// Diamond Office 런타임 에셋(D-140): vite가 URL(작은 파일은 data URL)로 바꾼다.
declare module '*.svg' {
  const url: string;
  export default url;
}
