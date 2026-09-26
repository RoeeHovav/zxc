"use client";
import * as React from "react";
import { Loader2, Rotate3d } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/misc";

/** Formats that the in-browser preview can display. */
export const PREVIEWABLE_MODELS = ["stl", "obj", "3mf"] as const;
export const canPreviewModel = (ext: string) => (PREVIEWABLE_MODELS as readonly string[]).includes(ext.toLowerCase());
const MAX_PREVIEW_BYTES = 150 * 1024 * 1024;

type Dims = { x: number; y: number; z: number; triangles: number };
type State = { phase: "loading" } | { phase: "ready"; dims: Dims } | { phase: "error"; message: string };

export function ModelPreviewButton({ fileId, name, extension, sizeBytes }: { fileId: string; name: string; extension: string; sizeBytes: number }) {
  const [open, setOpen] = React.useState(false);
  if (!canPreviewModel(extension)) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon-sm" aria-label={`Preview ${name} in 3D`} title="3D preview" onClick={() => setOpen(true)}>
        <Rotate3d />
      </Button>
      {open && (
        <DialogContent title={name} description="Drag to rotate · scroll or pinch to zoom · right-drag to pan" wide>
          {sizeBytes > MAX_PREVIEW_BYTES ? (
            <Alert tone="info">This file is too large to preview in the browser. Download it and open it in your slicer.</Alert>
          ) : (
            <ModelCanvas fileId={fileId} extension={extension.toLowerCase()} name={name} />
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

function ModelCanvas({ fileId, extension, name }: { fileId: string; extension: string; name: string }) {
  const host = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<State>({ phase: "loading" });

  React.useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      try {
        const [THREE, { OrbitControls }] = await Promise.all([import("three"), import("three/examples/jsm/controls/OrbitControls.js")]);
        const res = await fetch(`/api/files/${fileId}`);
        if (!res.ok) throw new Error(`The file could not be loaded (${res.status}).`);
        const data = await res.arrayBuffer();
        if (disposed) return;

        // Parse into a group of meshes, whatever the format.
        const root = new THREE.Group();
        const material = new THREE.MeshStandardMaterial({ color: modelColor(), metalness: 0.05, roughness: 0.6, flatShading: false });
        if (extension === "stl") {
          const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
          const geometry = new STLLoader().parse(data);
          geometry.computeVertexNormals();
          root.add(new THREE.Mesh(geometry, material));
        } else if (extension === "obj") {
          const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
          root.add(new OBJLoader().parse(new TextDecoder().decode(data)));
        } else {
          const { ThreeMFLoader } = await import("three/examples/jsm/loaders/3MFLoader.js");
          root.add(new ThreeMFLoader().parse(data));
        }
        let triangles = 0;
        root.traverse((o) => {
          const mesh = o as InstanceType<typeof THREE.Mesh>;
          if (!mesh.isMesh) return;
          mesh.material = material;
          const g = mesh.geometry;
          triangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        });
        if (triangles === 0) throw new Error("No printable geometry found in this file — download it and open it in your slicer.");

        // Printing files are Z-up in millimetres; measure before rotating to three.js's Y-up.
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const dims: Dims = { x: size.x, y: size.y, z: size.z, triangles };
        root.rotation.x = -Math.PI / 2;
        root.updateMatrixWorld(true);
        const worldBox = new THREE.Box3().setFromObject(root);
        const center = worldBox.getCenter(new THREE.Vector3());
        root.position.set(-center.x, -worldBox.min.y, -center.z); // sit on the build plate

        const el = host.current;
        if (!el || disposed) return;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        el.appendChild(renderer.domElement);
        renderer.domElement.setAttribute("role", "img");
        renderer.domElement.setAttribute("aria-label", `3D preview of ${name}: ${fmt(dims.x)} × ${fmt(dims.y)} × ${fmt(dims.z)} mm`);

        const scene = new THREE.Scene();
        scene.add(root);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f98, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 1.4);
        sun.position.set(1, 2, 1.5);
        scene.add(sun);
        const span = Math.max(size.x, size.y, size.z, 1);
        const grid = new THREE.GridHelper(Math.ceil((span * 1.6) / 10) * 10, 20, 0x94a3b8, 0xcbd5e1);
        (grid.material as InstanceType<typeof THREE.Material>).opacity = 0.5;
        (grid.material as InstanceType<typeof THREE.Material>).transparent = true;
        scene.add(grid);

        const camera = new THREE.PerspectiveCamera(40, 1, span / 100, span * 50);
        camera.position.set(span * 1.3, span * 1.1, span * 1.6);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, size.z / 2, 0);
        controls.enableDamping = true;

        let frame = 0;
        const render = () => {
          frame = 0;
          if (controls.update()) request(); // keep going while damping settles
          renderer.render(scene, camera);
        };
        const request = () => {
          if (!frame) frame = requestAnimationFrame(render);
        };
        const resize = () => {
          const w = el.clientWidth;
          const h = el.clientHeight;
          renderer.setSize(w, h, false);
          renderer.domElement.style.width = "100%";
          renderer.domElement.style.height = "100%";
          camera.aspect = w / Math.max(h, 1);
          camera.updateProjectionMatrix();
          request();
        };
        const ro = new ResizeObserver(resize);
        ro.observe(el);
        controls.addEventListener("change", request);
        resize();
        setState({ phase: "ready", dims });

        cleanup = () => {
          ro.disconnect();
          cancelAnimationFrame(frame);
          controls.dispose();
          root.traverse((o) => {
            const mesh = o as InstanceType<typeof THREE.Mesh>;
            if (!mesh.isMesh) return;
            mesh.geometry.dispose();
            (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => m.dispose());
          });
          grid.geometry.dispose();
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch (e) {
        if (!disposed) setState({ phase: "error", message: e instanceof Error ? e.message : "The model could not be displayed." });
      }
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [fileId, extension, name]);

  return (
    <div className="grid gap-3">
      <div ref={host} className="relative h-[55dvh] min-h-64 overflow-hidden rounded-lg border border-border bg-muted/40">
        {state.phase === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" /> Loading model…
          </div>
        )}
      </div>
      {state.phase === "error" && <Alert tone="warning">{state.message}</Alert>}
      {state.phase === "ready" && (
        <p className="text-sm tabular">
          <span className="font-medium">
            {fmt(state.dims.x)} × {fmt(state.dims.y)} × {fmt(state.dims.z)} mm
          </span>
          <span className="text-muted-foreground">
            {" "}
            (X × Y × Z bounding box, as stored in the file) · {state.dims.triangles.toLocaleString("en-US")} {state.dims.triangles === 1 ? "triangle" : "triangles"}
          </span>
        </p>
      )}
    </div>
  );
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });

function modelColor() {
  // The theme's primary colour, converted to sRGB via a canvas (tokens may be oklch()).
  try {
    const probe = document.createElement("span");
    probe.style.color = "var(--primary)";
    document.body.appendChild(probe);
    const css = getComputedStyle(probe).color;
    probe.remove();
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx || !css) return "#3b82f6";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return "#3b82f6";
  }
}
