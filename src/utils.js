// 共享工具函数
export function escapeHtml(value) {
  if (value == null) return '';
  const str = String(value);
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
