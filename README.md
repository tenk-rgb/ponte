# Ponte

Acesso remoto a máquinas Windows e Linux, e um quadro para os seus agentes de IA, num app só. Nasceu para substituir o mRemoteNG com uma tela mais limpa e menos coisa para configurar.

## O que faz

- Abre a área de trabalho de máquinas Windows por RDP, dentro da janela do app. Também abre Linux por RDP (xrdp) ou VNC.
- Na mesma conexão Linux tem terminal SSH e gerenciador de arquivos (SFTP). Dá para arrastar arquivos do Explorer para o servidor, baixar, renomear, criar pastas e abrir o terminal na pasta em que você está.
- Roda agentes como Claude Code, Codex e Gemini, ou qualquer programa de terminal, no seu PC ou num servidor Linux. O Quadro mostra todos lado a lado, ao vivo. Você digita em qualquer um ou clica duas vezes no título para assumir em tela cheia.
- Ditado por voz: clique no microfone e fale. O texto é digitado no último terminal em que você clicou.
- Traz as conexões RDP, SSH e VNC do mRemoteNG, com as senhas.
- Não tem barra lateral. As abas ficam numa faixa fina no topo e o resto da tela é da sessão. Ctrl+K busca qualquer conexão ou agente.

Uma conexão pede só nome, sistema, endereço, usuário e senha. Portas, domínio e o resto ficam em "Mais opções".

## Visual

O desenho parte de Brasília: o azul dos azulejos de Athos Bulcão como cor principal, o cinza do concreto aparente no fundo, o amarelo do ipê para o que está rodando e os três arcos da Ponte JK no logo e na aba ativa. A fonte é a Gabarito, da Naipe Foundry do Rio de Janeiro (licença OFL, em `wwwroot/fonts`). A barra de título, com minimizar, maximizar e fechar, é desenhada pelo próprio app. Segue o tema claro ou escuro do Windows.

## Instalar

Rode `artifacts\Ponte-Setup-1.1.0.exe`. Ele instala só para o seu usuário, sem pedir administrador, e já inclui o .NET. Precisa do WebView2, que vem com o Windows 10 e 11.

## Compilar

Requer o .NET 10 SDK e o Inno Setup 6.

```powershell
.\build.ps1
```

O instalador sai em `artifacts\`. Para rodar em modo de desenvolvimento, use `dotnet run --project src\Ponte`. Com a variável `PONTE_DEV=1` as ferramentas de desenvolvedor do WebView2 ficam ligadas.

## Como funciona

| Parte | Tecnologia |
|---|---|
| Janela | WinForms (.NET 10) com WebView2. A interface inteira é HTML/CSS/JS em `src/Ponte/wwwroot`. |
| RDP | Controle ActiveX de Área de Trabalho Remota do Windows (o mesmo do mstsc), embutido na janela. |
| SSH e SFTP | SSH.NET. A chave de cada servidor é guardada na primeira conexão; se mudar, o Ponte recusa e avisa. |
| VNC | noVNC na interface, com uma ponte WebSocket local para TCP. |
| Agentes locais | Pseudo console do Windows (ConPTY) e xterm.js. |
| Voz | Reconhecimento de fala do Windows. |
| Senhas | Criptografadas com DPAPI, presas ao seu usuário do Windows, em `%APPDATA%\Ponte\data.json`. |

O formato do `confCons.xml` e a criptografia de senhas do mRemoteNG (AES-GCM com PBKDF2-SHA1 a partir da senha padrão "mR3m") foram levantados com o REA, por análise estática do `mRemoteNG.exe` 1.76.

## Limites conhecidos

- O ditado precisa do "Reconhecimento de fala online" ligado em Configurações > Privacidade > Fala.
- Telnet, rlogin, HTTP e Citrix ICA do mRemoteNG ficaram de fora.
- Na primeira conexão RDP a um servidor com certificado próprio, o Windows mostra o aviso de certificado dele.
