# Yellowstone protocol provenance

These unmodified protocol definitions come from the signed
`rpcpool/yellowstone-grpc` release `v15.1.2+solana.4.2.0`.

| Asset | Release SHA-256 |
|---|---|
| `geyser.proto` | `2fedb3dafcd9f61ea3cb93cc0ab5bba6bc26685eb989664bf0bb1d582ec7a33c` |
| `solana-storage.proto` | `547e82681f26ce17347b25c7b91bb899d188bfb12f817b4d9b0c404f0ff80b22` |

Source release: <https://github.com/rpcpool/yellowstone-grpc/releases/tag/v15.1.2%2Bsolana.4.2.0>

The upstream `LICENSING.md` assigns `yellowstone-grpc-proto` and its
subdirectories the Apache-2.0 license. `LICENSE_APACHE2` is the license file
shipped with that protocol component. The generated Python bindings in
`yellowstone_proto/` were produced with `grpcio-tools 1.81.1`; only package-
relative import paths were adjusted.

Regeneration command from the repository root:

```powershell
uv run python -m grpc_tools.protoc "--proto_path=vendor/yellowstone/v15.1.2" "--python_out=yellowstone_proto" "--grpc_python_out=yellowstone_proto" "vendor/yellowstone/v15.1.2/geyser.proto" "vendor/yellowstone/v15.1.2/solana-storage.proto"
```

After regeneration, restore package-relative imports in `geyser_pb2.py` and
`geyser_pb2_grpc.py`; generated `.pyi` files are intentionally omitted because
the upstream `bytes` field name collides with the Python type in current mypy.
