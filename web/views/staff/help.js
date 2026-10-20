import { html } from '../../lib/deps.js'

// The teachers' guide, kept next to the screens it describes.
export function HelpTab() {
  return html`<article class="help">
    <h1 class="h2">Como usar o Prumo</h1>
    <p class="lede-small">Cada disciplina tem um número de vagas. Quando a rodada abre, quem confirma primeiro fica com a vaga,
      na ordem exata em que o servidor recebeu, até o milissegundo. Quem chega depois de lotar entra na lista de espera, que anda sozinha quando uma vaga abre.</p>

    <section>
      <h2 class="h3">1. Antes de abrir uma rodada</h2>
      <ol class="help-steps">
        <li><b>Cadastre os estudantes.</b> Em <i>Estudantes → Colar lista</i>, cole as colunas da planilha da secretaria (nome, e-mail, ano, turma).
          O nome sai no comprovante exatamente como estiver aqui. Só entra no Prumo quem estiver cadastrado.</li>
        <li><b>Crie a rodada.</b> Em <i>Rodadas → Nova rodada</i>: data e hora de abertura e de fechamento (horário de Brasília),
          quantas disciplinas cada estudante pode escolher e se pode haver duas no mesmo horário.</li>
        <li><b>Crie as disciplinas.</b> Vagas, anos permitidos e horário. Disciplinas com o mesmo <i>código de horário</i> (ex.: TER-T1) não podem ser escolhidas juntas.</li>
        <li><b>Confira como os estudantes vão ver.</b> O botão <i>Ver como estudante</i> mostra a tela real de cada ano, sem registrar nada.</li>
        <li><b>Publique.</b> A partir daí os estudantes veem a contagem regressiva. Os botões liberam sozinhos na hora exata, pelo relógio do servidor (não importa se o celular estiver adiantado).</li>
        <li><b>Peça para entrarem antes.</b> O login é por código enviado ao e-mail. Quem entra um dia antes já fica conectado e não depende do e-mail na hora da corrida.</li>
      </ol>
    </section>

    <section>
      <h2 class="h3">2. Durante a abertura</h2>
      <ul>
        <li>As vagas e as listas atualizam ao vivo em todas as telas.</li>
        <li>Abaixo das disciplinas, <i>Quem ainda não se inscreveu</i> mostra quem falta. <i>Copiar e-mails</i> prepara um aviso para essas pessoas.</li>
        <li>Cada vaga confirmada manda um comprovante em PDF por e-mail; o estudante também pode baixar pela própria tela.</li>
      </ul>
    </section>

    <section>
      <h2 class="h3">3. Depois</h2>
      <ul>
        <li><b>Desistências:</b> o estudante pede, com o motivo, e continua com a vaga até alguém da coordenação aprovar. Aprovada, a vaga vai para a próxima pessoa da espera, com e-mail e comprovante.</li>
        <li><b>Remover alguém:</b> em <i>Lista</i>, na disciplina. A vaga também vai para a espera.</li>
        <li><b>Mais vagas:</b> aumente o número em <i>Editar</i>. A lista de espera é chamada na ordem de chegada.</li>
        <li><b>Exceções:</b> <i>Lista → Inscrever estudante</i> coloca alguém à mão (pode até passar do limite de vagas).</li>
        <li><b>Planilhas:</b> <i>Exportar planilha</i> na disciplina ou na rodada inteira (abre no Excel).</li>
        <li><b>Próximo semestre:</b> <i>Duplicar</i> copia a rodada com as mesmas disciplinas, em rascunho. É só ajustar as datas.</li>
      </ul>
    </section>

    <section>
      <h2 class="h3">4. Comprovantes</h2>
      <p>Todo comprovante tem um código (ex.: AB12-CD34) e um QR. Quem escanear, ou digitar o código em
        <a href="#/verificar">Verificar comprovante</a>, vê na hora se a vaga é real e se ainda vale. O modelo do PDF pode ser trocado em <i>Ajustes</i>.</p>
    </section>

    <section>
      <h2 class="h3">5. Contas de teste</h2>
      <p>As contas de teste (Ana, Bruno, Carla, Davi, Professora, Administração) servem para experimentar sem e-mail. Elas só enxergam e alteram
        as rodadas e pessoas de teste: estudantes de verdade nunca veem rodadas de teste, e contas de teste não ocupam vagas reais.
        Antes de abrir para a escola, elas são desligadas e apagadas.</p>
    </section>

    <section>
      <h2 class="h3">6. Problemas comuns</h2>
      <dl class="help-faq">
        <dt>"Este e-mail não está cadastrado no Prumo."</dt>
        <dd>A pessoa não está em <i>Estudantes</i> (ou <i>Equipe</i>), ou o e-mail foi digitado diferente.</dd>
        <dt>O código não chega.</dt>
        <dd>Olhar o spam, esperar 1 minuto e pedir de novo. Em <i>Ajustes</i>, o quadro <i>Envio de e-mails</i> mostra se o envio está funcionando.</dd>
        <dt>Um estudante diz que clicou primeiro.</dt>
        <dd>A <i>Lista</i> da disciplina mostra o horário exato de cada inscrição, até o milissegundo, como o servidor recebeu.</dd>
        <dt>Alguém precisa sair do Prumo.</dt>
        <dd>Use <i>Desativar</i> em vez de excluir: as inscrições antigas continuam no histórico.</dd>
      </dl>
    </section>
  </article>`
}
