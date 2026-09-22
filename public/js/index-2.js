window.toggleCollapsible = window.toggleCollapsible || function(id, btn) {
  const body = document.getElementById(id);
  if (!body) return;
  const collapsed = body.classList.toggle('collapsed');
  if (btn) btn.classList.toggle('collapsed', collapsed);
};
