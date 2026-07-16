document.addEventListener('DOMContentLoaded', () => {
  const preloader = document.getElementById('preloader');
  if (!preloader) return;

  const hidePreloader = () => {
    preloader.classList.add('hidden');
  };

  window.addEventListener('load', hidePreloader, { once: true });
  window.setTimeout(hidePreloader, 900);
});
