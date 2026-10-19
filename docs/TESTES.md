# Testes

Os testes foram executados em 17/10/2026 no ambiente de desenvolvimento, com os resultados registrados abaixo. Nenhum resultado foi presumido: o que não pôde ser testado está listado na seção 4.

## 1. Como executar

### Testes de unidade e de aceitação (servidor)

Usam um PostgreSQL real e um servidor SMTP real, que sobe dentro do próprio teste.

```bash
createdb formacao_test
# padrão: postgres://formacao:formacao_dev@localhost:5432/formacao_test (troque exportando DATABASE_URL)
npm test
```

### Testes no navegador

Usam o Chromium, com celular emulado e câmera simulada por vídeo. Precisam de `ffmpeg` instalado.

```bash
createdb formacao_e2e   # ou defina E2E_DATABASE_URL
npm run build
npm run test:e2e
```

- O Playwright sobe o servidor compilado na porta 3100 e um receptor SMTP local na porta 2527.
- As capturas de tela e os PDFs gerados ficam em `test-results/e2e-artifacts/`.
- Os e-mails recebidos ficam em `test-results/mailbox/`.

## 2. Resultado da última execução

| Suíte | Resultado |
|---|---|
| Unidade (`tests/unit`) | **12 de 12 passaram** |
| Aceitação (`tests/integration`) | **28 de 28 passaram** |
| Navegador (`tests/e2e`) | **7 de 7 passaram** |
| `npm audit --omit=dev` | 0 vulnerabilidades conhecidas |
| `npm run typecheck` | sem erros |

## 3. Os 12 cenários de aceitação

Legenda: **A** = teste de aceitação no servidor; **N** = teste no navegador.

| # | Cenário | Como foi verificado | Resultado |
|---|---|---|---|
| 1 | Professor se inscreve e recebe protocolo e QR Code | **A:** inscrição devolve protocolo e token, e o QR contém só o link com o código aleatório. Validação de CPF, telefone, e-mail e nome no servidor. Duplicidade no mesmo evento é recusada, mas é permitida em outro evento. 20 inscrições simultâneas não passam do limite de vagas. O mesmo CPF enviado em paralelo gera uma única inscrição. Inscrição fora do prazo ou em evento em rascunho é recusada. **N:** inscrição completa pelo celular, com revisão, confirmação, protocolo e QR na tela | Passou |
| 2 | E-mail de confirmação | **A:** a mensagem é entregue a um servidor SMTP real e só fica "enviado" depois do aceite. **N:** o e-mail chega à caixa de teste com o QR Code anexado, e a tela mostra o estado em tempo real | Passou |
| 3 | Coordenação entra no painel e gerencia eventos | **A:** login válido funciona e senha errada é recusada. **N:** a coordenação cadastra escola e evento pelo painel no desktop | Passou |
| 4 | Credenciamento lê o QR pela câmera | **N:** celular emulado com câmera simulada exibindo o QR do participante, e a presença é registrada. **A:** o horário vem do servidor e o operador fica registrado | Passou |
| 5 | Leitura repetida não duplica | **A:** segunda leitura e 10 leituras simultâneas resultam numa única presença. **N:** a segunda leitura mostra "presença já registrada" | Passou |
| 6 | QR inválido é recusado | **A:** QR adulterado, inexistente, de outro evento, de inscrição cancelada ou substituído é recusado, assim como leitura fora da janela da sessão. **N:** a câmera lê um QR de outro site e mostra "QR Code inválido". Câmera negada mostra orientação e oferece a busca manual | Passou |
| 7 | Certificado só para quem cumpriu o critério | **A:** emissão só para elegíveis, sem duplicar ao liberar de novo, com reemissão mantendo o histórico, revogação e verificação pública. Critério de percentual mínimo com carga horária proporcional. **N:** depois do encerramento, só o participante presente recebe o certificado, e a página de verificação abre no celular | Passou |
| 8 | Falha de e-mail fica visível e pode ser reenviada | **A:** com o SMTP fora do ar, a mensagem fica "pendente" com o erro e uma nova tentativa agendada. Com o destinatário recusado, as tentativas se esgotam e a mensagem fica "falhou" e visível no painel. A nova tentativa não duplica a mensagem | Passou |
| 9 | Relatórios consistentes | **A:** os totais batem com o banco, e inscrições não são confundidas com pessoas. Exportação em CSV, XLSX e PDF. A versão resumida não traz dados pessoais, e toda exportação é auditada. **N:** os números do painel conferem (2 inscritos, 1 presente, 1 ausente, 1 certificado), e a lista de presença em PDF é baixada | Passou |
| 10 | Acesso indevido é bloqueado | **A:** sem sessão, nenhuma rota administrativa responde. Cada perfil acessa só o que lhe cabe. Requisição sem token CSRF é recusada. O QR Code não dá acesso ao painel. A conta é bloqueada após 5 senhas erradas, e há limite de tentativas por IP. O credenciamento só atua nos eventos designados. **N:** o perfil Consulta não vê nem abre telas administrativas | Passou |
| 11 | Uso no celular | **N:** inscrição, comprovante, credenciamento e verificação feitos em telas de iPhone 13 e Pixel 7 (emulação no Chromium) | Passou na emulação. Veja a seção 4 |
| 12 | Dados persistem após sair e reiniciar | **A:** depois de sair da conta e iniciar uma nova instância da aplicação, os dados continuam lá. **N:** depois de sair e entrar de novo, inscrições e presenças continuam no painel | Passou |

Além dos cenários, os testes de unidade cobrem:

- dígitos verificadores do CPF, máscara do CPF e telefone;
- regras do formulário de inscrição e da senha;
- cifra AES-GCM, incluindo detecção de adulteração;
- índice do CPF e alfabeto dos códigos;
- fases do evento e prazo de inscrição;
- proteção do CSV contra fórmulas.

## 4. O que ainda precisa ser testado em ambiente real

Estes pontos **não foram testados** e devem ser conferidos em homologação, antes do primeiro evento:

1. **Celulares físicos:** o teste usou emulação de tela no Chromium e uma câmera simulada por vídeo. Faltam:
   - leitura em iPhone com Safari, que tem motor próprio e não foi testado;
   - leitura em aparelhos Android de entrada;
   - leitura com pouca luz e com QR na tela de outro celular.
2. **Provedor de e-mail real:** o envio foi testado contra um servidor SMTP local. Faltam:
   - o provedor da Prefeitura, com TLS e autenticação;
   - a entrega em Gmail, Outlook e e-mails institucionais;
   - a verificação de que as mensagens não caem no spam (depende de SPF, DKIM e DMARC).
3. **HTTPS e domínio:** o Caddy e o Nginx estão configurados, mas não foram executados com um domínio real.
4. **Imagem Docker:** o `Dockerfile` não pôde ser construído no ambiente de desenvolvimento, porque o registro de imagens e o npm estavam inacessíveis de dentro do build. O build equivalente (`npm ci`, `npm run build`) foi testado fora do Docker.
5. **Backup e restauração:** os scripts não foram executados. Faça um ciclo completo de backup e restauração em homologação.
6. **Carga:** o teste de concorrência cobriu 20 inscrições e 10 leituras simultâneas. Não houve teste de carga com centenas de acessos, por exemplo na abertura de inscrições de um evento grande.
7. **Acessibilidade:** a interface usa rótulos associados aos campos, cor do texto ajustada automaticamente para manter contraste sobre a cor institucional e navegação por teclado. Não foi feita avaliação com leitor de tela nem auditoria WCAG completa.
8. **Instalação como aplicativo (PWA):** o manifesto e o service worker são servidos, mas a instalação não foi testada num aparelho.

### Roteiro de homologação sugerido

1. Configure a instituição e envie o logotipo.
2. Crie um evento de teste com 2 sessões.
3. Inscreva 3 pessoas por celulares diferentes, incluindo um iPhone, e confirme que os e-mails chegaram.
4. No dia, faça o credenciamento pela câmera de um celular. Leia um QR duas vezes e use a busca manual uma vez.
5. Faça uma correção de presença com justificativa.
6. Depois do encerramento, libere os certificados. Confira o PDF, a verificação pelo QR do certificado e o e-mail.
7. Exporte relatórios em CSV, XLSX e PDF nas versões resumida e detalhada, e confira a **Auditoria**.
8. Faça um backup e restaure-o num banco separado.
