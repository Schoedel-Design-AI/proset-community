# Processing Animations

Proset loads these Bodymovin/Lottie JSON files through Skottie:

- `transcription.json` for upload and transcription.
- `conversion.json` for ambiguity checking and artifact generation.

The checked-in files are lightweight placeholders. Replace either file without
changing application code. Prefer self-contained animations without external
images or fonts, a square artboard, a seamless loop, and a modest file size.
Skottie displays the first frame when reduced motion is enabled.
