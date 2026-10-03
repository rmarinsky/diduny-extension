import { useEffect, useRef } from "react";

/**
 * Modal confirmation built on the native <dialog>: showModal() provides the
 * backdrop, makes the page behind it inert, and turns Escape into "cancel".
 */
export function ConfirmDialog({
	body,
	cancelLabel,
	confirmLabel,
	onCancel,
	onConfirm,
	title,
}: {
	body: string;
	cancelLabel: string;
	confirmLabel: string;
	onCancel(): void;
	onConfirm(): void;
	title: string;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const cancelButton = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		const element = dialog.current;
		if (!element) return;
		if (!element.open) element.showModal();
		cancelButton.current?.focus();
		return () => element.close();
	}, []);

	return (
		<dialog
			aria-describedby="confirm-dialog-body"
			aria-labelledby="confirm-dialog-title"
			className="confirm-dialog"
			onCancel={(event) => {
				event.preventDefault();
				onCancel();
			}}
			ref={dialog}
		>
			<h2 id="confirm-dialog-title">{title}</h2>
			<p id="confirm-dialog-body">{body}</p>
			<div className="dialog-actions">
				<button
					className="secondary"
					onClick={onCancel}
					ref={cancelButton}
					type="button"
				>
					{cancelLabel}
				</button>
				<button onClick={onConfirm} type="button">
					{confirmLabel}
				</button>
			</div>
		</dialog>
	);
}
