import { type FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	DEFAULT_BFF_ORIGIN,
	getBffOrigin,
	setBffOrigin,
} from "../../lib/bff/client";
import "./style.css";

function Options() {
	const [origin, setOrigin] = useState(DEFAULT_BFF_ORIGIN);
	const [message, setMessage] = useState("");

	useEffect(() => {
		getBffOrigin()
			.then(setOrigin)
			.catch(() => setOrigin(DEFAULT_BFF_ORIGIN));
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

	return (
		<main>
			<h1>Diduny settings</h1>
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
			{message && <output>{message}</output>}
		</main>
	);
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Options />);
