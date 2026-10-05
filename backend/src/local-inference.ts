export function requireLocalInference(endpoint: string) {
  const url = new URL(endpoint);
  const host = url.hostname;
  const octets = host.split('.').map(Number);
  const ipv4 =
    octets.length === 4 && octets.every((x) => Number.isInteger(x) && x >= 0 && x <= 255);
  const privateIp =
    ipv4 &&
    (octets[0] === 127 ||
      octets[0] === 10 ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !(
      privateIp ||
      ['localhost', '[::1]', 'ollama', 'ocr', 'paddleocr'].includes(host) ||
      host.endsWith('.localhost')
    )
  )
    throw Error('仅允许本机或内网 Ollama / PaddleOCR，禁止付费云端推理接口');
}
