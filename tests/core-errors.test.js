import { expect, test } from "bun:test";
import {
	DidunyError,
	remoteAcquisitionUnavailableOnWeb,
} from "../src/core/errors";

test("keeps the web remote-acquisition refusal in the shared error taxonomy", () => {
	const error = remoteAcquisitionUnavailableOnWeb();

	expect(error).toBeInstanceOf(DidunyError);
	expect(error.code).toBe("remote_acquisition_unavailable_on_web");
});
