# Método Apps Academy para o Claude Code

Plugin do [Método Apps Academy](https://appsacademy.com.br): ele conduz a criação de um app com o Claude Code, passo a passo, da pesquisa de mercado até a loja.

É para alunos da Apps Academy. Para usar, você precisa de um convite e de uma assinatura ativa.

## Instalar

O caminho mais fácil é a sua página de ativação, que chega pelo convite: <https://metodo.appsacademy.com.br>. Ela mostra cada passo e gera a sua chave.

Você precisa de:

- [Claude Code](https://claude.com/product/claude-code), com uma assinatura do Claude;
- [Node.js](https://nodejs.org) 20 ou mais novo.

No terminal:

```sh
claude plugin marketplace add jhonatafsilva/metodo-apps-academy-plugin
claude plugin install metodo-apps-academy@apps-academy
```

Depois abra o Claude Code e guarde a sua chave, gerada na página de ativação:

```text
/plugin configure metodo-apps-academy@apps-academy
```

Cole a chave quando ele pedir a **Chave do Método Apps Academy**. Ela fica guardada no cofre do seu computador. Para trocar a chave, rode o mesmo comando.

## Usar

Crie uma pasta para o app, abra o Claude Code dentro dela e digite `/app`.

O plugin liga o **painel do app** em `http://127.0.0.1:4747`. Ele mostra cada passo enquanto acontece: a pesquisa, a persona, as telas e o protótipo. Para abrir o painel sem o Claude Code, rode na pasta do app:

```sh
node .metodo/painel.mjs --abrir
```

## O que sai do seu computador

- O plugin conversa com o servidor do método para receber os passos e registrar cada passo concluído, com um resumo curto do que foi entregue.
- O código do app, os arquivos da pasta e o conteúdo do painel do app ficam só no seu computador. O painel responde só a este computador e lê só a pasta `metodo/` do app.

Política de privacidade: <https://metodo.appsacademy.com.br/privacidade>.

## Este repositório

Este repositório só distribui o plugin. Ele é gerado a partir do repositório do método; mudanças feitas direto aqui são substituídas na próxima versão.
