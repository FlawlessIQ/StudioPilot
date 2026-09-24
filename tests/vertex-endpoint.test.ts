import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_VERTEX_LOCATION,
  vertexEndpoint,
  vertexHostForLocation,
  vertexLocationForModel,
} from "../functions/src/ai/vertex-endpoint.ts";

function withLocation<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.VERTEX_AI_LOCATION;
  if (value === undefined) delete process.env.VERTEX_AI_LOCATION;
  else process.env.VERTEX_AI_LOCATION = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.VERTEX_AI_LOCATION;
    else process.env.VERTEX_AI_LOCATION = previous;
  }
}

test("global is not a region and does not take a region prefix", () => {
  assert.equal(vertexHostForLocation("global"), "aiplatform.googleapis.com");
  assert.equal(
    vertexHostForLocation("us-east4"),
    "us-east4-aiplatform.googleapis.com",
  );
});

test("Gemini 3 and later are global regardless of the configured region", () => {
  withLocation("us-east4", () => {
    for (const model of [
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite",
      "gemini-3.5-flash-lite",
      "gemini-3.8-flash",
      "gemini-3.1-pro-preview",
      "gemini-4.0-pro",
    ]) {
      assert.equal(vertexLocationForModel(model), "global", model);
    }
  });
});

test("Gemini 2.5 keeps the configured region", () => {
  withLocation("us-east4", () => {
    assert.equal(vertexLocationForModel("gemini-2.5-pro"), "us-east4");
    assert.equal(vertexLocationForModel("gemini-2.5-flash"), "us-east4");
  });
  withLocation("us-central1", () => {
    assert.equal(vertexLocationForModel("gemini-2.5-pro"), "us-central1");
  });
  withLocation(undefined, () => {
    assert.equal(vertexLocationForModel("gemini-2.5-pro"), DEFAULT_VERTEX_LOCATION);
  });
});

/**
 * The global-only rule is a fact about the Gemini 3 line, not about Vertex. An
 * embedding or Imagen model forced onto `global` would be a new outage caused
 * by the fix for the old one.
 */
test("non-Gemini models are untouched by the global rule", () => {
  withLocation("us-east4", () => {
    assert.equal(vertexLocationForModel("text-embedding-004"), "us-east4");
    assert.equal(vertexLocationForModel("imagen-3.0-generate-001"), "us-east4");
    assert.equal(vertexLocationForModel(""), "us-east4");
  });
});

test("the endpoint pairs host and path location consistently", () => {
  withLocation("us-east4", () => {
    assert.equal(
      vertexEndpoint("studiohub-prod", "gemini-2.5-pro"),
      "https://us-east4-aiplatform.googleapis.com/v1/projects/studiohub-prod/locations/us-east4/publishers/google/models/gemini-2.5-pro:generateContent",
    );
    assert.equal(
      vertexEndpoint("studiohub-prod", "gemini-3.8-flash"),
      "https://aiplatform.googleapis.com/v1/projects/studiohub-prod/locations/global/publishers/google/models/gemini-3.8-flash:generateContent",
    );
  });
});

/**
 * The bug this whole module exists to prevent: a host built by prefixing a
 * region onto a location that is not one.
 */
test("no endpoint ever names a global-aiplatform host", () => {
  withLocation("global", () => {
    for (const model of ["gemini-2.5-pro", "gemini-3.8-flash"]) {
      const url = vertexEndpoint("studiohub-prod", model);
      assert.ok(
        !url.includes("global-aiplatform"),
        `${model} built a host that does not resolve: ${url}`,
      );
      assert.ok(url.startsWith("https://aiplatform.googleapis.com/"), url);
    }
  });
});

test("streaming keeps the sse suffix", () => {
  withLocation("us-east4", () => {
    assert.ok(
      vertexEndpoint("p", "gemini-2.5-pro", "streamGenerateContent").endsWith(
        ":streamGenerateContent?alt=sse",
      ),
    );
  });
});
