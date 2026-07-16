# Rapfi WebAssembly build

The `assets/rapfi/rapfi-single-simd128.*` files are a Renju-only WebAssembly
build of Rapfi for the `프로` AI difficulty.

## Source revisions

- Rapfi: <https://github.com/dhbloo/rapfi/tree/3aedf3a2ab0ab710a9f3d00e57d5287ceb864894>
- Networks submodule: <https://github.com/dhbloo/rapfi-networks/tree/918b757a129258e9e765f77fe17d507c2bb1a60b>
- Emscripten: 6.0.3
- CMake: 3.31.6
- Ninja: 1.11.1

Rapfi is distributed under GPL-3.0-or-later; see `COPYING.txt`. The bundled
network files are distributed under CC0; see `NETWORKS-LICENSE.txt`.

## Build configuration

The build embeds `config.toml`, `model210901.bin`, and only the two 15x15
Renju Mix9SVQ network files. The exact runtime configuration is preserved in
this directory as `config.toml`.

Configure and build from the Rapfi source root with an activated Emscripten
environment:

```powershell
emcmake cmake -S Rapfi -B Rapfi/build/dongne-wasm -G Ninja `
  -DCMAKE_BUILD_TYPE=Release `
  -DNO_COMMAND_MODULES=ON `
  -DNO_MULTI_THREADING=ON `
  -DUSE_WASM_SIMD=ON `
  -DUSE_WASM_SIMD_RELAXED=OFF `
  -DUSE_SSE=OFF `
  -DUSE_AVX2=OFF `
  -DUSE_AVX512=OFF
cmake --build Rapfi/build/dongne-wasm --target rapfi-single-simd128
```

`Networks/wasm_preloads.txt` was reduced to these entries before building:

```text
config-example/dongne-renju.toml@/config.toml
model210901.bin@/model210901.bin
mix9svqrenju_bs15_black.bin.lz4@/mix9svqrenju_bs15_black.bin.lz4
mix9svqrenju_bs15_white.bin.lz4@/mix9svqrenju_bs15_white.bin.lz4
```

## Artifact checksums

```text
C91F973304A28AECA7C5487DEBE468CED0990174D2EF5631F6ED0C349593C8C9  rapfi-single-simd128.js
C70D440224D5C97740EE5BB34BAEF4BD337ACA76D9C6085B1AB8C6BC9E1A7E2A  rapfi-single-simd128.wasm
CB62B37736C8AA449FE6990AFBB194739C077B260276F0CFB1036551582AF1D6  rapfi-single-simd128.data
```
