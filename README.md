# simulador-ev — Simulador de Charge Point OCPP 1.6J

## 1. Objetivo

Simulador de carregador veicular elétrico (**Charge Point**) compatível com **OCPP 1.6 JSON**, executado em Docker local, para validar a comunicação com qualquer CSMS OCPP 1.6J (inclusive a plataforma Inovative) e simular uma sessão de carga completa.

## 2. Arquitetura

```text
Charge Point Simulator ──WebSocket (ocpp1.6)──▶ CSMS / OCPP Server
```

Esta versão é **somente o Charge Point** (sem CSMS nem banco de dados), com uma interface web de controle embutida. Toda interação é por variáveis de ambiente, logs e mensagens OCPP.

## 3. Requisitos

- Docker Desktop (Windows) com Docker Compose v2.24+
- Para desenvolvimento local: Node.js 20+ (testado com 22/24)

## 4. Estrutura

```text
src/
├── index.ts               # bootstrap, sinais SIGTERM/SIGINT
├── config.ts              # leitura/validação de variáveis, montagem da URL
├── ocpp/
│   ├── client.ts          # WebSocket, CallManager (UniqueId/timeout), reconexão com backoff
│   ├── messages.ts        # CALL/CALLRESULT/CALLERROR + payload de MeterValues
│   ├── handlers.ts        # roteador de CALLs do CSMS (ponto de extensão)
│   └── types.ts
├── simulator/
│   ├── charger.ts         # orquestra Boot, Heartbeat, sessão, comandos remotos, reset
│   ├── connector.ts       # conector + transação ativa
│   ├── state-machine.ts   # estados e transições válidas
│   ├── vehicle.ts / battery.ts
│   └── meter.ts           # fórmulas elétricas e registrador de energia
└── utils/logger.ts        # logs estruturados com mascaramento de segredos
tests/                     # Vitest (não exigem CSMS real)
```

## 5–7. Instalação e configuração

```bash
cp .env.example .env      # ajuste CSMS_URL, CHARGE_POINT_ID etc. (.env não é versionado)
```

| Variável | Padrão | Descrição |
|---|---|---|
| `CHARGE_POINT_ID` | — (obrigatória) | Identidade do Charge Point |
| `CSMS_URL` | — (obrigatória) | `ws://` ou `wss://` |
| `APPEND_CHARGE_POINT_ID_TO_URL` | `true` | `true`: URL final = `CSMS_URL/CHARGE_POINT_ID` |
| `CONNECTOR_ID` | `1` | Conector simulado |
| `ID_TAG` | `SIMULATOR001` | idTag das sessões locais |
| `CHARGER_VENDOR` / `CHARGER_MODEL` / `CHARGER_SERIAL_NUMBER` / `CHARGER_FIRMWARE_VERSION` | Inovative / EV-Simulator / = ID / 0.1.0 | BootNotification |
| `CHARGER_TYPE` | `AC` | Somente AC no MVP (DC é recusado na validação) |
| `MAX_POWER_KW` | `22` | Potência entregue |
| `VOLTAGE` | `380` | Tensão (V) |
| `PHASES` | `3` | 1 ou 3 |
| `POWER_FACTOR` | `0.98` | Fator de potência |
| `VEHICLE_BATTERY_KWH` / `VEHICLE_INITIAL_SOC` / `VEHICLE_TARGET_SOC` | 60 / 30 / 90 | Veículo (alvo deve ser > inicial) |
| `METER_INTERVAL_SECONDS` | `10` | Intervalo de MeterValues |
| `HEARTBEAT_INTERVAL_SECONDS` | `60` | Usado só se o Boot não trouxer `interval` |
| `RECONNECT_INTERVAL_SECONDS` / `RECONNECT_MAX_INTERVAL_SECONDS` | 5 / 60 | Backoff: base × 2ⁿ, limitado ao máximo (5, 10, 20, 40, 60…) |
| `OCPP_CALL_TIMEOUT_SECONDS` | `30` | Timeout das chamadas pendentes |
| `LOG_LEVEL` | `info` | debug \| info \| warn \| error |
| `AUTO_START_TRANSACTION` / `AUTO_START_DELAY_SECONDS` | false / 5 | Sessão automática após Boot aceito |

Configuração inválida é erro fatal com mensagem clara. CSMS offline **nunca** encerra o processo.

## 8. OCPP 1.6J

- Subprotocolo `ocpp1.6` negociado explicitamente (conexão é fechada se o servidor responder outro).
- Frames `[2,id,action,payload]`, `[3,id,payload]`, `[4,id,code,desc,details]`.
- Chamadas correlacionadas por `UniqueId` (UUID) com timeout configurável; pendentes são rejeitadas na queda da conexão.
- Após reconexão: novo `BootNotification`, timers de heartbeat não duplicados.

## Interface web

Abra **http://localhost:8085** (publicada só em `127.0.0.1`, inacessível de outras máquinas). Ela roda dentro do próprio processo do simulador (sem container extra) e mostra: conexão com o CSMS, estado do conector, SOC, potência/tensão/corrente/energia, logs ao vivo. Permite iniciar sessão (Authorize + StartTransaction), parar carga, desconectar o veículo (`EVDisconnected`), Reset Soft/Hard e ajustar potência e SOC inicial/alvo.

- `WEB_PORT` (padrão 8080, `0` desativa) e `WEB_HOST_PORT` (porta no host, padrão 8085).
- "Iniciar" só fica habilitado com o Charge Point registrado (Boot aceito pelo CSMS).
- Sem autenticação: não exponha a porta fora do localhost. POSTs exigem o cabeçalho `X-Simulator: 1`.

## 9. Build e testes

```bash
npm install
npm run typecheck
npm test
npm run build
```

## 10–13. Docker

Todos os comandos devem ser executados **somente dentro de `C:\Projetos\simulador-ev`** (ou com `-f C:\Projetos\simulador-ev\docker-compose.yml`):

```bash
docker compose config        # valida
docker compose build
docker compose up -d
docker compose logs -f
docker compose ps
docker compose down          # para e remove SOMENTE este projeto
# de fora da pasta:
docker compose -f C:\Projetos\simulador-ev\docker-compose.yml down
```

Recursos criados: container `inovative-simulador-ev-ocpp16`, imagem `inovative-simulador-ev-ocpp16:0.1.0`, network `inovative-simulador-ev-net`. Sem volumes; única porta publicada: `127.0.0.1:8085` (interface web). **Nunca** use `docker system prune` ou equivalentes globais.

## 14–15. Conexão com o CSMS

- CSMS no Windows host: `CSMS_URL=ws://host.docker.internal:9000/ocpp`
- CSMS remoto: `CSMS_URL=wss://ocpp.exemplo.com/ocpp`
- URL sem ID no final: `APPEND_CHARGE_POINT_ID_TO_URL=false`

## 16. Mensagens implementadas

| Charge Point → CSMS | CSMS → Charge Point |
|---|---|
| BootNotification, Heartbeat, StatusNotification, Authorize, StartTransaction, MeterValues, StopTransaction | RemoteStartTransaction, RemoteStopTransaction, Reset (Soft/Hard, lógico) |

Outras actions recebem `CALLERROR NotImplemented`. Para adicionar (ChangeAvailability, GetConfiguration, TriggerMessage…), inclua um `case` em `src/ocpp/handlers.ts`.

- **RemoteStart**: `Rejected` se o conector não está `Available`, há transação/partida em curso ou o `connectorId` difere; não executa Authorize (a autorização é do CSMS).
- **RemoteStop**: só aceita o `transactionId` ativo.
- **Reset**: reset lógico, o container **nunca** é reiniciado. Soft encerra a transação (`SoftReset`), limpa estado e refaz o Boot. Hard encerra (`HardReset`), derruba o WebSocket e reconecta (novo Boot).
- Se um `StopTransaction` ocorrer offline, é enfileirado e reenviado após novo Boot aceito.

## 17. Máquina de estados

Estados: `Available, Preparing, Charging, SuspendedEV, SuspendedEVSE, Finishing, Unavailable, Faulted`. Transições inválidas lançam erro; cada mudança gera `StatusNotification` (`errorCode: NoError`).

## 18. Fluxo de sessão

```text
Available → Preparing → Authorize → StartTransaction → Charging → MeterValues…
→ (SOC alvo | RemoteStop) → Finishing → StopTransaction → Available
```

O `transactionId` retornado pelo CSMS é guardado e usado em MeterValues e StopTransaction. `meterStart`/`meterStop` são o registrador acumulativo do medidor (Wh), não a energia da sessão.

## 19. Simulação elétrica

- `I = P / (√3 · V · FP)` (trifásico) ou `P / (V · FP)` (monofásico) — 22 kW, 380 V, FP 0,98 ≈ 34,1 A
- `Energia (kWh) = Potência (kW) × tempo (h)`, com tempo real transcorrido
- `SOC ganho (%) = energia / capacidade × 100`, limitado a 0–100% e ao SOC alvo
- MeterValues: `Energy.Active.Import.Register` (Wh), `Power.Active.Import` (W), `Current.Import` (A), `Voltage` (V), `SoC` (Percent); timestamps ISO 8601 UTC

## 20. Troubleshooting

- **Fica em CONNECTING/RECONNECT**: confira `CSMS_URL`, porta e se o CSMS escuta em `0.0.0.0` (não só em 127.0.0.1) quando acessado via `host.docker.internal`.
- **Subprotocolo recusado**: o CSMS precisa aceitar `ocpp1.6`.
- **404/handshake falha**: tente alternar `APPEND_CHARGE_POINT_ID_TO_URL`.
- **Boot Rejected/Pending**: o charge point precisa estar cadastrado no CSMS; o simulador repete conforme o `interval`.
- **Authorize recusado**: cadastre o `ID_TAG` no CSMS.
- Use `LOG_LEVEL=debug` para ver os payloads.

## 21. Limitações

Somente AC e um conector; potência constante (sem curva de carga); sem Smart Charging, reservas, configuração remota ou falhas simuladas; não persiste estado entre reinícios do processo; sem healthcheck Docker (não há endpoint HTTP, e não foi criado um artificial).

## 22. Roadmap

- **v0.2** ~~painel web, conectar/desconectar, iniciar/parar, alterar SOC/potência~~ (feito); simulação de falhas
- **v0.3** múltiplos conectores e Charge Points; perfis de carregador
- **v0.4** Smart Charging (SetChargingProfile, ClearChargingProfile, GetCompositeSchedule)
- **v0.5** cenários automatizados; carga de testes com dezenas/centenas de Charge Points virtuais
- **Futuro** OCPP 2.0.1
