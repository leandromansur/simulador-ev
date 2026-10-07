# Reproduzir o simulador EV em Docker local

Este guia permite que outro colaborador obtenha uma cópia do projeto e execute o simulador OCPP 1.6J em seu próprio computador, sem instalar Node.js para a execução normal. O container inclui o simulador e sua interface web; o CSMS é um serviço separado e precisa estar acessível pela rede.

## 1. Pré-requisitos

- Acesso ao repositório `simulador-ev` e Git instalado, caso vá clonar o projeto.
- Docker Desktop iniciado no Windows ou macOS, ou Docker Engine no Linux.
- Docker Compose v2.24 ou superior (`docker compose`, com espaço).
- Acesso a um CSMS OCPP 1.6J e permissão para cadastrar/usar o Charge Point ID escolhido.

Para conferir as ferramentas no PowerShell:

```powershell
docker --version
docker compose version
docker info
```

`docker info` deve concluir sem erro de conexão com o daemon. No Docker Desktop, aguarde o estado indicar que o engine está em execução.

## 2. Obter o projeto

Clone o repositório remoto autorizado pela equipe, ou use uma cópia já disponibilizada pelo colaborador. O endereço do repositório não é fixado neste documento: use a URL oficial compartilhada pela equipe.

Exemplo no PowerShell:

```powershell
git clone <URL-DO-REPOSITORIO> simulador-ev
Set-Location .\simulador-ev
```

Confirme que a pasta atual contém `docker-compose.yml`, `Dockerfile`, `package.json`, `package-lock.json` e `.env.example`:

```powershell
Get-ChildItem -Force
```

Execute os próximos comandos Docker a partir dessa pasta. Alternativamente, informe `-f <caminho>\docker-compose.yml` em cada comando.

## 3. Configurar o ambiente

Crie o arquivo local `.env` usando o modelo versionado:

```powershell
Copy-Item .env.example .env
notepad .env
```

Edite ao menos estes valores:

```dotenv
CHARGE_POINT_ID=SIM-001
CSMS_URL=wss://mobi-ocpp.inovative.cloud
CSMS_PASSWORD=
```

- `CHARGE_POINT_ID`: identidade única deste simulador, reconhecida/cadastrada no CSMS. Combine com a equipe antes de usar um ID compartilhado.
- `CSMS_URL`: endereço WebSocket do CSMS, iniciado por `ws://` ou `wss://`.
- `CSMS_PASSWORD`: senha HTTP Basic, se exigida pelo CSMS. O usuário Basic é o próprio `CHARGE_POINT_ID`; deixe vazio apenas quando o servidor permitir conexão sem autenticação.

O exemplo está preenchido com o endpoint DEV da Inovative. Use outro endereço se o seu ambiente exigir. Com `APPEND_CHARGE_POINT_ID_TO_URL=true` (padrão), o simulador acrescenta `/<CHARGE_POINT_ID>` ao endereço configurado. Se o servidor espera exatamente a URL informada, defina `APPEND_CHARGE_POINT_ID_TO_URL=false`.

Não compartilhe nem versione `.env`: ele pode conter credenciais. O `.gitignore` já exclui esse arquivo. Nunca cole senha em chamados, logs ou documentação compartilhada.

### CSMS executado no mesmo computador

Dentro do container, `localhost` aponta para o próprio container, não para o computador host. Para acessar um CSMS executado no computador, use `host.docker.internal`:

```dotenv
CSMS_URL=ws://host.docker.internal:9000/ocpp
APPEND_CHARGE_POINT_ID_TO_URL=false
```

Substitua a porta e o caminho pelos valores reais do CSMS. O servidor precisa aceitar conexões vindas do Docker; se estiver escutando somente em `127.0.0.1`, talvez seja necessário ajustar sua configuração de rede. O Compose configura `host.docker.internal` também no Docker Engine Linux.

## 4. Validar e iniciar

Valide a configuração resolvida do Compose sem iniciar containers:

```powershell
docker compose config --quiet
```

Construa a imagem e inicie o simulador em segundo plano:

```powershell
docker compose build
docker compose up -d
```

A primeira construção baixa a imagem base Node.js e instala dependências; ela pode demorar mais que as próximas. O Dockerfile compila TypeScript em uma etapa de build e executa a imagem final com Node.js 22, sem precisar de Node.js instalado no host.

Confirme o estado:

```powershell
docker compose ps
```

Veja os logs de conexão OCPP e inicialização:

```powershell
docker compose logs -f simulador-ev
```

Use `Ctrl+C` para sair do acompanhamento de logs; isso não para o container.

## 5. Usar e conferir o simulador

Abra [http://localhost:8085](http://localhost:8085). A interface é publicada somente no loopback do computador (`127.0.0.1`), não em outras máquinas da rede. Ela permite acompanhar a conexão, o estado, os valores da simulação e os logs; após o Boot ser aceito pelo CSMS, é possível controlar a sessão pela interface.

A sequência esperada nos logs é conexão WebSocket com subprotocolo `ocpp1.6`, envio de `BootNotification` e resposta aceita pelo CSMS. O simulador pode permanecer tentando reconectar se o CSMS estiver indisponível; isso, por si só, não encerra o processo.

As configurações elétricas e de temporização do `.env.example` são um ponto de partida. Entre outras opções, o arquivo permite ajustar `CONNECTOR_ID`, `ID_TAG`, `MAX_POWER_KW`, `VOLTAGE`, `PHASES`, parâmetros de bateria/SOC, `LOG_LEVEL` e `AUTO_START_TRANSACTION`. As alterações de configuração entram em vigor ao recriar o container:

```powershell
docker compose up -d --force-recreate
```

Para alterar a porta web no computador, defina `WEB_HOST_PORT` no `.env` e recrie o container. A porta interna padrão é `8080`; a URL local será `http://localhost:<WEB_HOST_PORT>`.

## 6. Comandos de operação

Todos estes comandos afetam o projeto Compose `inovative-simulador-ev` desta pasta:

```powershell
# Estado dos serviços
docker compose ps

# Logs recentes
docker compose logs --tail 100 simulador-ev

# Acompanhar logs continuamente
docker compose logs -f simulador-ev

# Reiniciar o serviço
docker compose restart simulador-ev

# Reconstruir a imagem após mudanças no código
docker compose build --no-cache
docker compose up -d

# Parar e remover o container e a network deste projeto
docker compose down
```

O projeto usa a imagem `inovative-simulador-ev-ocpp16:0.1.0`, o container `inovative-simulador-ev-ocpp16` e a network `inovative-simulador-ev-net`. Esses nomes são fixos; para executar duas cópias simultaneamente no mesmo computador, será necessário alterar nomes e porta no Compose para evitar conflitos.

Não há volume de dados: o estado da simulação não é persistido e é perdido ao reiniciar o processo. `docker compose down` remove os recursos deste projeto, mas preserva a imagem construída. Não use `docker system prune`, `docker container prune` ou comandos globais de remoção como procedimento normal deste guia.

## 7. Diagnóstico rápido

- **`docker compose` não conecta ao engine:** inicie o Docker Desktop ou o daemon Docker e repita `docker info`.
- **Erro de configuração com `CHARGE_POINT_ID` ou `CSMS_URL`:** confirme que criou `.env` no diretório do Compose e preencheu os dois valores obrigatórios.
- **Container reinicia ou termina logo após iniciar:** consulte `docker compose logs --tail 100 simulador-ev`; erros de configuração são exibidos ali.
- **Interface web não abre:** confirme `docker compose ps`, verifique se a porta `8085` está ocupada e ajuste `WEB_HOST_PORT` se necessário.
- **Conexão fica tentando reconectar:** confira URL, caminho final, porta, DNS, firewall, credenciais e disponibilidade do CSMS. Para CSMS no host, não use `localhost` dentro do container.
- **Handshake falha ou subprotocolo é recusado:** confirme que o endpoint oferece OCPP 1.6J com subprotocolo `ocpp1.6`; confira também `APPEND_CHARGE_POINT_ID_TO_URL` e o formato de caminho exigido pelo servidor.
- **Boot fica Rejected/Pending ou autorização é recusada:** solicite ao responsável pelo CSMS o cadastro do Charge Point ID e do `ID_TAG` usados.

Para investigar payloads OCPP, defina `LOG_LEVEL=debug` no `.env` e recrie o container. Trate os logs como potencialmente sensíveis e não os compartilhe sem revisar o conteúdo.

## 8. Executar testes sem Docker (opcional)

Node.js não é necessário para o fluxo Docker. Para desenvolvimento ou validação de código no host, instale Node.js 20 ou superior e execute:

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

## macOS e Linux

O fluxo Docker é o mesmo: entre na pasta do projeto, crie `.env` a partir do exemplo, valide, construa e inicie com `docker compose`. Para copiar o arquivo no macOS/Linux:

```bash
cp .env.example .env
```

Edite `.env` com seu editor de texto e não o adicione ao Git. Para verificar o daemon, use `docker info`. A interface permanece vinculada a `127.0.0.1` na máquina que executa os containers.
