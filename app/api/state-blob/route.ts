function encodeBlobPath(blobName: string) {
  return blobName
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function storageErrorFromXml(xml: string, fallback: string) {
  const match = xml.match(/<Message>([\s\S]*?)<\/Message>/);
  return match?.[1]?.replace(/\n/g, " ").trim() || fallback;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      accountName?: string;
      containerName?: string;
      blobName?: string;
      accessToken?: string;
    };

    const accountName = payload.accountName?.trim() ?? "";
    const containerName = payload.containerName?.trim() ?? "";
    const blobName = payload.blobName?.trim() ?? "";
    const accessToken = payload.accessToken?.trim() ?? "";

    if (!accountName || !containerName || !blobName || !accessToken) {
      return Response.json(
        { error: "Storage account, container, blob/key, and access token are required." },
        { status: 400 },
      );
    }

    if (!/^[a-z0-9]{3,24}$/.test(accountName)) {
      return Response.json(
        { error: "Storage account name must be 3-24 lowercase letters or numbers." },
        { status: 400 },
      );
    }

    const url = `https://${accountName}.blob.core.windows.net/${encodeURIComponent(
      containerName,
    )}/${encodeBlobPath(blobName)}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-ms-version": "2023-11-03",
      },
    });
    const text = await response.text();

    if (!response.ok) {
      return Response.json(
        { error: storageErrorFromXml(text, response.statusText) },
        { status: response.status },
      );
    }

    JSON.parse(text);
    return Response.json({ state: text });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load state blob." },
      { status: 500 },
    );
  }
}
