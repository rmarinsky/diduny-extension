const btn = document.getElementById("grant") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLElement;

btn.addEventListener("click", async () => {
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		for (const track of stream.getTracks()) track.stop();
		statusEl.className = "success";
		statusEl.textContent = "Microphone access granted! You can close this tab.";
		btn.style.display = "none";
		// Auto-close after a short delay
		setTimeout(() => window.close(), 1500);
	} catch (err) {
		statusEl.className = "error";
		statusEl.textContent = `Denied: ${err instanceof Error ? err.message : "Unknown error"}`;
	}
});
