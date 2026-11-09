# Echo — locally hosted AI and memory

Echo's inference runs through a local Ollama model. The application does not call OpenAI or another paid AI API. On first startup, the app checks Ollama and automatically downloads the configured model into a persistent volume. Public web research uses DuckDuckGo's HTML search and Echo's local model to summarize returned snippets.

## Run Echo on a machine you control

Requirements: Docker Engine with Docker Compose, outbound internet for the first model download and web searches, and enough free memory/disk for the model. The default `qwen2.5:3b` model is a small quantized model; local inference speed depends on your CPU/GPU. A machine with 8 GB RAM is a practical starting point, with several GB of disk available for the model and containers.

```sh
git clone https://github.com/pepitogustavo/echo-self-writer.git
cd echo-self-writer
docker compose up --build -d
docker compose logs -f echo
```

Open `http://localhost:3000`. The first boot may take a while because Echo pulls the model automatically. The `ollama_models` volume retains the downloaded model; `echo_data` retains memory and research across restarts. Stop the services with `docker compose down` (this preserves volumes); `docker compose down -v` deletes the model and Echo's saved data.

You can select another Ollama model in a `.env` file:

```env
OLLAMA_MODEL=qwen2.5:3b
PORT=3000
RESEARCH_INTERVAL_HOURS=6
```

Choose a model your machine can run. Model downloads and inference do not incur API charges, but use your machine's electricity, storage, and network. GPU acceleration is optional; the commented Compose section documents NVIDIA setup.

## Run without Docker

Install Ollama on the same host as Echo or on a machine reachable by the app, then pull a model:

```sh
ollama pull qwen2.5:3b
npm ci
OLLAMA_BASE_URL=http://127.0.0.1:11434 OLLAMA_MODEL=qwen2.5:3b npm start
```

For a remote Ollama host, set `OLLAMA_BASE_URL` to its reachable URL. Do not expose Ollama publicly without appropriate network controls.

## What the app does

- Chats and reflects using the local model.
- Automatically downloads a missing configured model at startup, unless `OLLAMA_AUTO_PULL=false`.
- Conducts periodic research by searching public web snippets, then summarizing them locally and retaining source links.
- Persists memory, research findings, and homepage evolution in the mounted data directory.
- Reports local-model readiness at `/health`.

This setup removes paid AI API calls; it cannot provide compute or 24/7 uptime independently of the host machine. Render's existing web service does not automatically run Ollama alongside this app: use the Compose deployment on a machine that can run both containers, or deliberately configure a reachable self-hosted Ollama server.
