// The stop page an IP-logging link lands on instead of loading. The link it
// stopped is in the fragment, which never leaves the browser.
const url = location.hash.slice(1);
const $ = (id) => document.getElementById(id);
const ask = async (message) => {
  const res = await chrome.runtime.sendMessage(message);
  if (!res?.ok) throw new Error(res?.error ?? 'No response');
  return res.value;
};

$('url').textContent = url;
ask({ type: 'ipLoggerStopped', url })
  .then((logger) => logger && ($('what').textContent = `It goes through ${logger.service}, an IP-logging service (${logger.domain}).`))
  .catch(() => {});

$('back').onclick = () => (history.length > 1 ? history.back() : window.close());
$('open').onclick = async () => {
  try {
    await ask({ type: 'ipLoggerOpen', url });
    location.replace(url);
  } catch (error) {
    $('status').textContent = error.message;
  }
};
