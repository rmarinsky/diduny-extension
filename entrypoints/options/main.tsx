import { type FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	getDefaultMicrophoneId,
	setDefaultMicrophoneId,
} from "../../lib/audio/microphone";
import {
	DEFAULT_BFF_ORIGIN,
	getBffOrigin,
	setBffOrigin,
} from "../../lib/bff/client";
import {
	deliveryOrigin,
	getDisabledDeliveryOrigins,
	setDeliveryEnabled,
} from "../../lib/delivery/site-settings";
import "./style.css";

function Options() {
	const [origin, setOrigin] = useState(DEFAULT_BFF_ORIGIN);
	const [message, setMessage] = useState("");
	const [microphoneId, setMicrophoneId] = useState("");
	const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
	const [site, setSite] = useState("");
	const [disabledSites, setDisabledSites] = useState<string[]>([]);

	useEffect(() => {
		getBffOrigin()
			.then(setOrigin)
			.catch(() => setOrigin(DEFAULT_BFF_ORIGIN));
		getDefaultMicrophoneId().then((value) => setMicrophoneId(value ?? ""));
		getDisabledDeliveryOrigins().then(setDisabledSites);
		navigator.mediaDevices
			.enumerateDevices()
			.then((devices) =>
				setMicrophones(
					devices.filter((device) => device.kind === "audioinput"),
				),
			)
			.catch(() => setMicrophones([]));
	}, []);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		try {
			const saved = await setBffOrigin(origin);
			setOrigin(saved);
			setMessage("Saved. Diduny will use this BFF for the next request.");
		} catch (error) {
			setMessage(
				error instanceof Error ? error.message : "Could not save BFF origin.",
			);
		}
	};

	const saveMicrophone = async () => {
		await setDefaultMicrophoneId(microphoneId || null);
		setMessage(
			"Saved. Diduny will use this microphone for the next recording.",
		);
	};

	const disableSite = async (event: FormEvent) => {
		event.preventDefault();
		const normalized = deliveryOrigin(site);
		if (!normalized) {
			setMessage("Enter a full http or https site URL.");
			return;
		}
		await setDeliveryEnabled(normalized, false);
		setDisabledSites(await getDisabledDeliveryOrigins());
		setSite("");
		setMessage(`Delivery disabled for ${normalized}.`);
	};

	const enableSite = async (siteOrigin: string) => {
		await setDeliveryEnabled(siteOrigin, true);
		setDisabledSites(await getDisabledDeliveryOrigins());
		setMessage(`Delivery enabled for ${siteOrigin}.`);
	};

	return (
		<main>
			<h1>Diduny settings</h1>
			<section>
				<h2>Connection</h2>
				<form onSubmit={submit}>
					<label htmlFor="bff-origin">Local BFF origin</label>
					<input
						id="bff-origin"
						type="url"
						value={origin}
						onChange={(event) => setOrigin(event.target.value)}
						required
					/>
					<p>Use localhost, with any local port.</p>
					<button type="submit">Save</button>
				</form>
			</section>

			<section>
				<h2>Microphone</h2>
				<label htmlFor="default-microphone">Default microphone</label>
				<select
					id="default-microphone"
					value={microphoneId}
					onChange={(event) => setMicrophoneId(event.target.value)}
				>
					<option value="">System default</option>
					{microphones.map((microphone, index) => (
						<option key={microphone.deviceId} value={microphone.deviceId}>
							{microphone.label || `Microphone ${index + 1}`}
						</option>
					))}
				</select>
				<button type="button" onClick={() => void saveMicrophone()}>
					Save microphone
				</button>
			</section>

			<section>
				<h2>Sites</h2>
				<form onSubmit={disableSite}>
					<label htmlFor="delivery-site">
						Disable direct delivery on a site
					</label>
					<input
						id="delivery-site"
						type="url"
						value={site}
						onChange={(event) => setSite(event.target.value)}
						placeholder="https://example.com"
						required
					/>
					<button type="submit">Disable site</button>
				</form>
				{disabledSites.length > 0 ? (
					<ul>
						{disabledSites.map((siteOrigin) => (
							<li key={siteOrigin}>
								<span>{siteOrigin}</span>
								<button
									type="button"
									onClick={() => void enableSite(siteOrigin)}
								>
									Enable
								</button>
							</li>
						))}
					</ul>
				) : (
					<p>Direct delivery is enabled on every site you allow.</p>
				)}
			</section>
			{message && <output>{message}</output>}
		</main>
	);
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Options />);
