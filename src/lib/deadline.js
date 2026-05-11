/**
 * @param {Promise<T>} p
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withDeadline(p, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => {
      reject(new Error(`${label} 超过 ${ms / 1000}s 无响应（请检查网络、VPN、SUPABASE_URL 是否正确）`));
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

module.exports = { withDeadline };
