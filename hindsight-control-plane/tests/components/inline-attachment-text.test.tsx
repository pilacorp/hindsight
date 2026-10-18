// @vitest-environment jsdom
/**
 * Rendering retained text that carries attachment placeholders.
 *
 * The stored text holds `⟦hs-att:<id>⟧` tokens where an image or file sat.
 * Showing those raw would put a content hash in front of a reader, so they are
 * expanded in place — and *what* they expand to depends on metadata the API
 * returns beside the text. Getting that wrong is quiet: an <img> pointed at a
 * PDF renders as a broken-image icon rather than an error anyone would chase.
 *
 * Every fetch goes through the control-plane proxy, never the dataplane `url`
 * the API returns, because the browser cannot authenticate against the
 * dataplane. And it goes through `authedFetch` (bearer attached) rather than a
 * raw `<img src>`/`<a href>`, which would send no Authorization header and 401:
 * the bytes are loaded into a `blob:` URL. Both are asserted here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const authedFetch = vi.fn();
vi.mock("@/lib/api", () => ({ authedFetch: (...args: unknown[]) => authedFetch(...args) }));

import {
  AttachmentStrip,
  InlineAttachmentText,
  hasInlineAttachment,
} from "@/components/ui/inline-attachment-text";

const BLOB_URL = "blob:mock-object-url";

beforeEach(() => {
  authedFetch.mockReset();
  authedFetch.mockResolvedValue({ ok: true, blob: async () => new Blob(["bytes"]) });
  // jsdom implements neither; the hook creates and revokes an object URL.
  globalThis.URL.createObjectURL = vi.fn(() => BLOB_URL);
  globalThis.URL.revokeObjectURL = vi.fn();
});

const IMAGE_ID = "c414cd0e204d";
const FILE_ID = "e5a66e3e1525";
const IMAGE = { id: IMAGE_ID, kind: "image", media_type: "image/png", byte_size: 10158 };
const FILE = {
  id: FILE_ID,
  kind: "file",
  media_type: "application/pdf",
  byte_size: 11471,
  filename: "escalation.pdf",
};

afterEach(cleanup);

describe("hasInlineAttachment", () => {
  it("detects a placeholder and is not confused by ordinary prose", () => {
    expect(hasInlineAttachment(`see ⟦hs-att:${IMAGE_ID}⟧ here`)).toBe(true);
    expect(hasInlineAttachment("no attachments in this article")).toBe(false);
  });

  it("does not leak regex state between calls", () => {
    // A /g regex advances lastIndex; a shared one would return false on the
    // second identical call and silently stop rendering attachments.
    const text = `⟦hs-att:${IMAGE_ID}⟧`;
    expect(hasInlineAttachment(text)).toBe(true);
    expect(hasInlineAttachment(text)).toBe(true);
  });
});

describe("InlineAttachmentText", () => {
  it("renders an image in the position its placeholder occupied", async () => {
    render(
      <InlineAttachmentText
        bankId="bank-a"
        text={`before ⟦hs-att:${IMAGE_ID}⟧ after`}
        attachments={[IMAGE]}
      />
    );

    // The bytes are fetched with the bearer token and shown as a blob: URL.
    const img = await screen.findByRole("img");
    expect(img.getAttribute("src")).toBe(BLOB_URL);
    expect(authedFetch).toHaveBeenCalledWith(`/api/banks/bank-a/attachments/${IMAGE_ID}`);
    // Clickable: the inline preview is scaled down, so it must also be the way
    // to open the full image.
    expect(screen.getByRole("link").getAttribute("href")).toBe(BLOB_URL);
    expect(screen.getByText(/before/)).toBeTruthy();
    expect(screen.getByText(/after/)).toBeTruthy();
  });

  it("renders a non-image attachment as a downloadable card, not an image", async () => {
    render(
      <InlineAttachmentText bankId="bank-a" text={`policy: ⟦hs-att:${FILE_ID}⟧`} attachments={[FILE]} />
    );

    expect(screen.queryByRole("img")).toBeNull();
    // The card is a link only once the fetch resolves its href (an <a> with no
    // href has no link role), so wait for it.
    const link = await screen.findByRole("link");
    expect(link.getAttribute("href")).toBe(BLOB_URL);
    expect(authedFetch).toHaveBeenCalledWith(`/api/banks/bank-a/attachments/${FILE_ID}`);
    expect(screen.getByText("escalation.pdf")).toBeTruthy();
    expect(screen.getByText(/application\/pdf/)).toBeTruthy();
  });

  it("keeps images and files apart when both appear in one body", async () => {
    render(
      <InlineAttachmentText
        bankId="bank-a"
        text={`shot ⟦hs-att:${IMAGE_ID}⟧ policy ⟦hs-att:${FILE_ID}⟧`}
        attachments={[IMAGE, FILE]}
      />
    );

    // One link for the image preview, one for the file card — both appear only
    // after their bytes are fetched into a blob: URL.
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(2));
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("always fetches through the proxy, never the dataplane url", async () => {
    render(
      <InlineAttachmentText
        bankId="bank-a"
        text={`⟦hs-att:${IMAGE_ID}⟧`}
        attachments={[{ ...IMAGE, url: "/v1/default/banks/bank-a/attachments/" + IMAGE_ID }]}
      />
    );

    // The dataplane path would 401 from a browser: it has no credentials.
    await screen.findByRole("img");
    expect(authedFetch).toHaveBeenCalledWith(`/api/banks/bank-a/attachments/${IMAGE_ID}`);
  });

  it("falls back to an image when no metadata is supplied", async () => {
    // The pre-attachments shape. An <img> that fails degrades to the same
    // "unavailable" note, so guessing image is the safe default.
    render(<InlineAttachmentText bankId="bank-a" text={`⟦hs-att:${IMAGE_ID}⟧`} />);

    expect(await screen.findByRole("img")).toBeTruthy();
  });

  it("leaves text with no placeholders exactly as it was", () => {
    render(<InlineAttachmentText bankId="bank-a" text="just prose, nothing attached" />);

    expect(screen.getByText("just prose, nothing attached")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("AttachmentStrip", () => {
  it("renders each attachment for a memory whose text names none of them", async () => {
    // A fact reads "[image: image/png]" rather than a placeholder, so its
    // attachments can only be shown beside it.
    render(<AttachmentStrip bankId="bank-a" attachments={[IMAGE, FILE]} />);

    await screen.findByRole("img");
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByText("escalation.pdf")).toBeTruthy();
  });

  it("renders nothing at all when there are no attachments", () => {
    const { container } = render(<AttachmentStrip bankId="bank-a" attachments={[]} />);

    expect(container.firstChild).toBeNull();
  });
});
