# Teste local: LendControl no seu PC + app no celular

O computador vira o servidor. O celular (no mesmo Wi-Fi) usa o app conectado a ele.
Tudo fica no seu PC: nada vai para a internet, a não ser o e-mail do backup, se você ativar.

## 1. Instalar (uma vez só)
1. **Docker Desktop**: baixe em https://www.docker.com/products/docker-desktop/ , instale com as opções padrão,
   reinicie o PC se ele pedir e abra o Docker Desktop até aparecer **Engine running**.
   (Se ele pedir para atualizar o "WSL", aceite.)
2. **Baixar o sistema**: no GitHub do projeto, botão verde **Code > Download ZIP**, e extraia numa pasta,
   ex.: `C:\LendControl`. (Ou use o zip que veio junto com este guia.)

## 2. Ligar o servidor
1. Abra a pasta `teste-local` e dê dois cliques em **INICIAR.bat**.
2. Na primeira vez ele pergunta:
   - seu nome, **e-mail e senha de login** (você vai entrar com eles no app);
   - o Gmail para o backup (opcional, veja o item 4). Para pular, só aperte Enter.
3. O Windows pede permissão de administrador uma vez: é para liberar a porta 3000 no Firewall. Clique **Sim**.
4. A primeira vez demora de 5 a 15 minutos (ele monta o sistema). Nas próximas, menos de 1 minuto.
5. No fim aparece **LENDCONTROL NO AR** com o endereço para o celular, por exemplo `192.168.0.10:3000`,
   e o sistema abre no navegador do PC.

## 3. Usar no celular
1. Celular no **mesmo Wi-Fi** do PC.
2. Instale o `lendcontrol-pro-v6.5.0.apk` (permita "instalar apps desconhecidos" quando o Android pedir).
3. Abra o app, digite o endereço mostrado (ex.: `192.168.0.10:3000`) e toque em **Testar e salvar**.
4. Entre com o e-mail e a senha que você criou.

## 4. Backup em planilha por e-mail
O sistema gera uma planilha Excel (clientes, empréstimos, parcelas, pagamentos, carteiras, repasses e resumo)
toda **segunda às 08:00** e envia por e-mail, além do botão de gerar na hora.

1. **Senha de app do Google** (o Gmail não aceita a senha normal):
   ative a verificação em duas etapas da sua conta e crie a senha em https://myaccount.google.com/apppasswords
   (nome: LendControl). Ela tem 16 letras.
2. Dê dois cliques em **CONFIGURAR-EMAIL.bat** e informe o Gmail e a senha de app (ou faça isso na primeira vez, no INICIAR).
3. No sistema: **Configurações > Backup**: ligue o envio, informe o e-mail que vai **receber**
   (pode ser o mesmo, e dá para adicionar outros, como o do contador) e toque em **Testar envio agora**.
4. Também dá para **baixar a planilha** na mesma tela, sem e-mail, e para **restaurar** a partir dela.

O envio automático de segunda só acontece se o PC e o Docker estiverem ligados nesse horário.

## Desligar e religar
- **PARAR.bat** desliga. Os dados ficam guardados no Docker.
- **INICIAR.bat** liga de novo, com os mesmos dados.
- O Docker Desktop reinicia o sistema sozinho quando você liga o PC, se ele estiver configurado para abrir com o Windows.

## Se o celular não conectar
- Confira se os dois estão no **mesmo Wi-Fi** (não use a rede de convidados nem dados móveis).
- No navegador do celular, abra `http://IP-DO-PC:3000`. Se não abrir, é o Firewall:
  menu Iniciar > "Firewall do Windows Defender" > Configurações avançadas > Regras de Entrada > Nova Regra >
  Porta > TCP 3000 > Permitir > marque Particular > nome "LendControl 3000".
- Em **Configurações > Rede e Internet**, deixe o Wi-Fi do PC como **rede Particular**.
- O IP do PC pode mudar quando o roteador reinicia. O INICIAR.bat sempre mostra o atual;
  no app use **Alterar servidor**.

## Importante
- O arquivo `teste-local\.env.local` guarda as chaves do sistema (inclusive a que protege os CPFs).
  Não compartilhe e guarde uma cópia: sem ele, os dados criptografados não podem ser lidos.
- Para recomeçar do zero (apaga tudo): `docker compose --env-file .env.local down -v` dentro da pasta e apague o `.env.local`.
