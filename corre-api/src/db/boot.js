'use strict';

// Trava de boot (Lei 3): a aplicação só sobe com credencial que NÃO consegue
// mexer no log de eventos. Todo ponto de entrada da aplicação (servidor HTTP,
// worker, o que vier) chama esta função antes de servir qualquer coisa;
// credencial de dono, superusuário ou com escrita em eventos derruba o
// processo no boot. Migrations não passam por aqui — rodam como corre_dono
// de propósito.

async function exigePapelDeAplicacao(client) {
  const { rows } = await client.query(`
    SELECT
      current_user AS papel,
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superusuario,
      pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'eventos'::regclass))
        = current_user::text AS dono_de_eventos,
      has_table_privilege(current_user, 'eventos', 'UPDATE') AS pode_update,
      has_table_privilege(current_user, 'eventos', 'DELETE') AS pode_delete,
      has_table_privilege(current_user, 'eventos', 'TRUNCATE') AS pode_truncate,
      has_any_column_privilege(current_user, 'eventos', 'UPDATE') AS pode_update_coluna
  `);
  const conexao = rows[0];

  const motivos = [];
  if (conexao.superusuario) motivos.push('é superusuário');
  if (conexao.dono_de_eventos) motivos.push('é dono da tabela eventos');
  if (conexao.pode_update || conexao.pode_update_coluna) motivos.push('tem UPDATE em eventos');
  if (conexao.pode_delete) motivos.push('tem DELETE em eventos');
  if (conexao.pode_truncate) motivos.push('tem TRUNCATE em eventos');

  if (motivos.length > 0) {
    throw new Error(
      `boot recusado: a credencial "${conexao.papel}" ${motivos.join(', ')}. `
      + 'A aplicação sobe somente com papel restrito (corre_app).',
    );
  }
  return conexao.papel;
}

module.exports = { exigePapelDeAplicacao };
