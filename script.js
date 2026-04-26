import { ADMIN_EMAIL, auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const STATUS_LABEL = {
  pending: "Pendente",
  approved: "Aprovado",
  rejected: "Rejeitado",
  deactivated: "Desativado"
};

const elementos = {
  telaAuth: document.getElementById("tela-auth"),
  telaApp: document.getElementById("tela-app"),
  mensagemAuth: document.getElementById("mensagem-auth"),
  mensagemApp: document.getElementById("mensagem-app"),
  formLogin: document.getElementById("form-login"),
  formRegistro: document.getElementById("form-registro"),
  formTransacao: document.getElementById("form-transacao"),
  botaoLogout: document.getElementById("botao-logout"),
  tituloUsuario: document.getElementById("titulo-usuario"),
  saldoAtual: document.getElementById("saldo-atual"),
  totalEntradas: document.getElementById("total-entradas"),
  totalSaidas: document.getElementById("total-saidas"),
  listaTransacoes: document.getElementById("lista-transacoes"),
  secaoAdmin: document.getElementById("secao-admin"),
  listaUsuariosAdmin: document.getElementById("lista-usuarios-admin"),
  transacaoData: document.getElementById("transacao-data")
};

let usuarioAtual = null;
let limparEscutaTransacoes = null;
let limparEscutaUsuarios = null;
let limparEscutaStatus = null;

function exibirMensagem(elemento, texto, tipo) {
  elemento.textContent = texto;
  elemento.className = `mensagem ${tipo}`;
}

function ocultarMensagem(elemento) {
  elemento.textContent = "";
  elemento.className = "mensagem oculto";
}

function definirDataPadrao() {
  elementos.transacaoData.value = new Date().toISOString().slice(0, 10);
}

function formatarMoeda(valor) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(valor);
}

function formatarData(dataString) {
  return new Date(`${dataString}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function limparEscutas() {
  if (limparEscutaTransacoes) {
    limparEscutaTransacoes();
    limparEscutaTransacoes = null;
  }

  if (limparEscutaUsuarios) {
    limparEscutaUsuarios();
    limparEscutaUsuarios = null;
  }

  if (limparEscutaStatus) {
    limparEscutaStatus();
    limparEscutaStatus = null;
  }
}

function mostrarTelaAuth() {
  usuarioAtual = null;
  limparEscutas();
  elementos.telaApp.classList.add("oculto");
  elementos.telaAuth.classList.remove("oculto");
  elementos.secaoAdmin.classList.add("oculto");
}

function mostrarTelaApp() {
  elementos.telaAuth.classList.add("oculto");
  elementos.telaApp.classList.remove("oculto");
}

function traduzirErroAuth(codigo) {
  const mapa = {
    "auth/email-already-in-use": "Este email já está em uso.",
    "auth/invalid-email": "O email informado é inválido.",
    "auth/weak-password": "A senha é muito fraca. Use pelo menos 6 caracteres.",
    "auth/user-not-found": "Nenhuma conta foi encontrada com este email.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/invalid-login-credentials": "Email ou senha inválidos.",
    "auth/network-request-failed": "Falha de conexão. Verifique sua internet e tente novamente.",
    "auth/too-many-requests": "Muitas tentativas seguidas. Aguarde um pouco e tente novamente."
  };

  return mapa[codigo] || "Ocorreu um erro inesperado. Verifique a configuração do Firebase.";
}

async function registrarUsuario(email, senha) {
  const credencial = await createUserWithEmailAndPassword(auth, email, senha);
  await setDoc(doc(db, "users", credencial.user.uid), {
    uid: credencial.user.uid,
    email,
    status: "pending",
    createdAt: serverTimestamp()
  });
  await signOut(auth);
}

async function fazerLogin(email, senha) {
  await signInWithEmailAndPassword(auth, email, senha);
}

async function fazerLogout() {
  await signOut(auth);
}

function calcularResumo(transacoes) {
  const entradas = transacoes
    .filter((item) => item.tipo === "entrada")
    .reduce((total, item) => total + item.valor, 0);

  const saidas = transacoes
    .filter((item) => item.tipo === "saida")
    .reduce((total, item) => total + item.valor, 0);

  return {
    entradas,
    saidas,
    saldo: entradas - saidas
  };
}

function renderizarTransacoes(transacoes) {
  const resumo = calcularResumo(transacoes);
  elementos.saldoAtual.textContent = formatarMoeda(resumo.saldo);
  elementos.totalEntradas.textContent = formatarMoeda(resumo.entradas);
  elementos.totalSaidas.textContent = formatarMoeda(resumo.saidas);

  if (!transacoes.length) {
    elementos.listaTransacoes.innerHTML = `
      <div class="transacao-vazia">
        <p>Nenhuma transação cadastrada ainda. Adicione a primeira no formulário acima.</p>
      </div>
    `;
    return;
  }

  const ordenadas = [...transacoes].sort((atual, proxima) => {
    if (atual.data === proxima.data) {
      return (proxima.createdAtMs || 0) - (atual.createdAtMs || 0);
    }

    return atual.data < proxima.data ? 1 : -1;
  });

  elementos.listaTransacoes.innerHTML = ordenadas
    .map((transacao) => {
      const classe = transacao.tipo === "entrada" ? "entrada" : "saida";
      const valor = transacao.tipo === "entrada"
        ? `+${formatarMoeda(transacao.valor)}`
        : `-${formatarMoeda(transacao.valor)}`;

      return `
        <article class="linha-transacao">
          <span class="pill-tipo ${classe}">${transacao.tipo === "entrada" ? "Entrada" : "Saída"}</span>
          <div>
            <h4>${transacao.descricao}</h4>
            <small>${formatarData(transacao.data)}</small>
          </div>
          <div class="valor-transacao ${classe}">
            <p>${valor}</p>
            <small>Documento do Firestore</small>
          </div>
          <button class="botao-excluir" type="button" data-excluir="${transacao.id}">Excluir</button>
        </article>
      `;
    })
    .join("");
}

function iniciarEscutaTransacoes(uid) {
  if (limparEscutaTransacoes) {
    limparEscutaTransacoes();
  }

  const consulta = query(collection(db, "transactions"), where("uid", "==", uid));
  limparEscutaTransacoes = onSnapshot(
    consulta,
    (snapshot) => {
      const transacoes = snapshot.docs.map((item) => {
        const dados = item.data();
        return {
          id: item.id,
          ...dados,
          createdAtMs: dados.createdAt?.toMillis ? dados.createdAt.toMillis() : 0
        };
      });

      renderizarTransacoes(transacoes);
    },
    () => {
      exibirMensagem(elementos.mensagemApp, "Não foi possível carregar as transações do Firestore.", "erro");
    }
  );
}

function renderizarUsuariosAdmin(usuarios) {
  if (!usuarios.length) {
    elementos.listaUsuariosAdmin.innerHTML = `
      <div class="transacao-vazia">
        <p>Nenhum usuário encontrado na coleção <code>users</code>.</p>
      </div>
    `;
    return;
  }

  elementos.listaUsuariosAdmin.innerHTML = usuarios
    .map((usuario) => `
      <article class="linha-admin" data-uid="${usuario.uid}">
        <div>
          <strong>${usuario.email}</strong>
          <small>UID: ${usuario.uid}</small>
        </div>
        <span class="pill-status ${usuario.status}">${STATUS_LABEL[usuario.status] || usuario.status}</span>
        <div class="acoes-admin">
          <button class="botao-admin-acao" type="button" data-status="approved" data-uid="${usuario.uid}">Aprovar</button>
          <button class="botao-admin-acao" type="button" data-status="rejected" data-uid="${usuario.uid}">Rejeitar</button>
          <button class="botao-admin-acao" type="button" data-status="deactivated" data-uid="${usuario.uid}">Desativar</button>
        </div>
      </article>
    `)
    .join("");
}

function iniciarEscutaUsuariosAdmin() {
  if (limparEscutaUsuarios) {
    limparEscutaUsuarios();
  }

  const consulta = query(collection(db, "users"), orderBy("email", "asc"));
  limparEscutaUsuarios = onSnapshot(
    consulta,
    (snapshot) => {
      const usuarios = snapshot.docs.map((item) => item.data());
      renderizarUsuariosAdmin(usuarios);
    },
    () => {
      exibirMensagem(elementos.mensagemApp, "Não foi possível carregar a lista de usuários do Firestore.", "erro");
    }
  );
}

async function validarAcesso(user) {
  const ehAdmin = user.email === ADMIN_EMAIL;

  if (ehAdmin) {
    return {
      permitido: true,
      admin: true,
      status: "approved"
    };
  }

  const referenciaUsuario = doc(db, "users", user.uid);
  const snapshotUsuario = await getDoc(referenciaUsuario);

  if (!snapshotUsuario.exists()) {
    return {
      permitido: false,
      status: "missing",
      mensagem: "Seu cadastro não foi encontrado na coleção users."
    };
  }

  const dados = snapshotUsuario.data();

  if (dados.status === "approved") {
    return {
      permitido: true,
      admin: false,
      status: dados.status
    };
  }

  if (dados.status === "pending") {
    return {
      permitido: false,
      status: dados.status,
      mensagem: "Cadastro criado com sucesso. Aguarde aprovação do administrador."
    };
  }

  if (dados.status === "rejected") {
    return {
      permitido: false,
      status: dados.status,
      mensagem: "Seu acesso foi rejeitado pelo administrador."
    };
  }

  return {
    permitido: false,
    status: "deactivated",
    mensagem: "Conta desativada pelo administrador"
  };
}

function iniciarEscutaStatusUsuario(user) {
  if (user.email === ADMIN_EMAIL) {
    return;
  }

  if (limparEscutaStatus) {
    limparEscutaStatus();
  }

  limparEscutaStatus = onSnapshot(doc(db, "users", user.uid), async (snapshotUsuario) => {
    if (!snapshotUsuario.exists()) {
      exibirMensagem(elementos.mensagemAuth, "Seu cadastro não foi encontrado na coleção users.", "erro");
      await fazerLogout();
      return;
    }

    const dados = snapshotUsuario.data();
    if (dados.status !== "approved") {
      const mensagem = dados.status === "deactivated"
        ? "Conta desativada pelo administrador"
        : dados.status === "rejected"
          ? "Seu acesso foi rejeitado pelo administrador."
          : "Seu cadastro voltou para o status pendente.";

      exibirMensagem(elementos.mensagemAuth, mensagem, dados.status === "pending" ? "info" : "erro");
      await fazerLogout();
    }
  });
}

async function prepararApp(user) {
  usuarioAtual = user;
  elementos.tituloUsuario.textContent = `Olá, ${user.email}`;
  ocultarMensagem(elementos.mensagemApp);
  mostrarTelaApp();
  iniciarEscutaTransacoes(user.uid);
  iniciarEscutaStatusUsuario(user);

  if (user.email === ADMIN_EMAIL) {
    elementos.secaoAdmin.classList.remove("oculto");
    iniciarEscutaUsuariosAdmin();
  } else {
    elementos.secaoAdmin.classList.add("oculto");
  }
}

async function tratarMudancaAutenticacao(user) {
  limparEscutas();

  if (!user) {
    mostrarTelaAuth();
    return;
  }

  try {
    const validacao = await validarAcesso(user);

    if (!validacao.permitido) {
      exibirMensagem(
        elementos.mensagemAuth,
        validacao.mensagem,
        validacao.status === "pending" ? "info" : "erro"
      );
      await fazerLogout();
      return;
    }

    await prepararApp(user);
  } catch {
    exibirMensagem(elementos.mensagemAuth, "Erro ao validar acesso no Firestore.", "erro");
    await fazerLogout();
  }
}

async function enviarRegistro(evento) {
  evento.preventDefault();
  ocultarMensagem(elementos.mensagemAuth);

  const dados = new FormData(elementos.formRegistro);
  const email = dados.get("email").toString().trim();
  const senha = dados.get("senha").toString();

  try {
    await registrarUsuario(email, senha);
    elementos.formRegistro.reset();
    exibirMensagem(
      elementos.mensagemAuth,
      "Conta registrada com sucesso. Agora aguarde aprovação do administrador.",
      "sucesso"
    );
  } catch (erro) {
    exibirMensagem(elementos.mensagemAuth, traduzirErroAuth(erro.code), "erro");
  }
}

async function enviarLogin(evento) {
  evento.preventDefault();
  ocultarMensagem(elementos.mensagemAuth);

  const dados = new FormData(elementos.formLogin);
  const email = dados.get("email").toString().trim();
  const senha = dados.get("senha").toString();

  try {
    await fazerLogin(email, senha);
    elementos.formLogin.reset();
  } catch (erro) {
    exibirMensagem(elementos.mensagemAuth, traduzirErroAuth(erro.code), "erro");
  }
}

async function enviarTransacao(evento) {
  evento.preventDefault();
  ocultarMensagem(elementos.mensagemApp);

  if (!usuarioAtual) {
    return;
  }

  const dados = new FormData(elementos.formTransacao);
  const tipo = dados.get("tipo").toString();
  const valor = Number(dados.get("valor"));
  const descricao = dados.get("descricao").toString().trim();
  const data = dados.get("data").toString();

  if (!tipo || !descricao || !data || Number.isNaN(valor) || valor <= 0) {
    exibirMensagem(elementos.mensagemApp, "Preencha todos os campos da transação corretamente.", "erro");
    return;
  }

  try {
    await addDoc(collection(db, "transactions"), {
      uid: usuarioAtual.uid,
      tipo,
      valor,
      descricao,
      data,
      createdAt: serverTimestamp()
    });

    elementos.formTransacao.reset();
    definirDataPadrao();
    exibirMensagem(elementos.mensagemApp, "Transação salva com sucesso no Firestore.", "sucesso");
  } catch {
    exibirMensagem(elementos.mensagemApp, "Não foi possível salvar a transação no Firestore.", "erro");
  }
}

async function excluirTransacao(id) {
  try {
    await deleteDoc(doc(db, "transactions", id));
    exibirMensagem(elementos.mensagemApp, "Transação excluída com sucesso.", "sucesso");
  } catch {
    exibirMensagem(elementos.mensagemApp, "Não foi possível excluir a transação.", "erro");
  }
}

async function atualizarStatusUsuario(uid, status) {
  try {
    await updateDoc(doc(db, "users", uid), { status });
    exibirMensagem(elementos.mensagemApp, "Status do usuário atualizado com sucesso.", "sucesso");
  } catch {
    exibirMensagem(elementos.mensagemApp, "Não foi possível atualizar o status do usuário.", "erro");
  }
}

elementos.formRegistro.addEventListener("submit", enviarRegistro);
elementos.formLogin.addEventListener("submit", enviarLogin);
elementos.formTransacao.addEventListener("submit", enviarTransacao);
elementos.botaoLogout.addEventListener("click", async () => {
  await fazerLogout();
});

elementos.listaTransacoes.addEventListener("click", (evento) => {
  const botao = evento.target.closest("button[data-excluir]");
  if (!botao) {
    return;
  }

  excluirTransacao(botao.dataset.excluir);
});

elementos.listaUsuariosAdmin.addEventListener("click", (evento) => {
  const botao = evento.target.closest("button[data-status]");
  if (!botao) {
    return;
  }

  atualizarStatusUsuario(botao.dataset.uid, botao.dataset.status);
});

definirDataPadrao();
onAuthStateChanged(auth, tratarMudancaAutenticacao);
