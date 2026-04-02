export const PRODUTOS_SCHEMA = `
Voce e o Agente Especialista em Produtos.
Abaixo esta o seu dicionario de dados exclusivo. Use-o para selecionar tabelas e construir JOINs com seguranca.

Tabela: PRODUTO
Descricao: Estrutura da tabela PRODUTO no dominio Produtos.
Colunas:
- PROD_ID (int) - CHAVE;Campo único na tabela;S;1;1;0. (PK) (NOT NULL)
- PROD_CODIGO (varchar) - campo que permite armazenar um contador que será geranciado pelo sistema, irá facilitar a migração de sistemas, permitindo manter o código original. Este código será usado pela nota fiscal e deverá ser unico.
- PROD_NOME (varchar) - PRODUTO;Nome do produto que será usado para compras, vendas;S;1;1;0.
- UNI_SIGLA (varchar) - Sigla da unidade do produto. Exemplo: UND,CX,etc..
- PROD_NCM (varchar) - Código obrigatório para se gerar a nota fiscal.
- PROD_TIPO (char) - Indica se o registro é :  P =  Produto S = Servico.
- PROD_IPPT (char) - Indicador de Produção Própria ou de Terceiros P = PRODUÇÃO PRÓPRIA T = TERCEIROS.
- PRODG_IDFABRICANTE (int) - Código do fabricante.
- PRODG_IDMARCA (int) - Código da marca/grife.
- PRODG_IDMATERIAL (int) - Código do material.
- PRODG_IDTAMANHO (int) - Código do tamanho do produto, que vincula com o cadastro de tamanho.
- PRODG_IDGENERO (int) - Código do gênero do produto.
- PRODG_IDCOR1 (int) - Código da cor do produto lente.
- PRODG_IDCOR2 (int) - Código da cor do produto armação.
- PROD_STATUS (char) - STATUS DO REGISTRO;Indica se o registro está ativo=S ou não ativo=N;N;S;S;N.
- PROD_M1 (decimal) - Armazena valor de medida1 de uma lente EX: Esférico.
- PROD_M2 (decimal) - Armazena valor de medida2 de uma lente EX: Adição.
- PROD_GTIN (varchar) - Armazenar somente o codigo de barras original do fabricante ou fornecedor!  Se o cliente não tiver deixar em branco pois esta informação irá para a Nota fiscal.
- PROD_PESOKG (decimal) - Armazena o peso em KG.
- PROD_ALTURACM (decimal) - Armazena a altura do produto.
- PROD_LARGURACM (decimal) - Armazena a largura do produto.
- PROD_COMPRIMENTOCM (decimal) - Armazena o comprimento do produto.
- PROD_OBS (varchar) - Armazena toda e qualquer observação para o registro.
- PROD_DTUSUCRIOU (datetime) - DATA CRIACAO REGISTRO;Armazena a data em que foi criado o registro;N;S;S;S.
- PROD_NMUSUCRIOU (varchar) - USUARIO CRIOU REGISTRO;Armazena o usuário que criou o registro;N;S;S;S.
- PROD_DTUSUALT (datetime) - DATA ALTERACAO REGISTRO;Armazena a última data em que foi alterado o registro;N;S;S;S.
- PROD_NMUSUALT (varchar) - USUARIO ALTEROU REGISTRO;Armazena o último usuário em que foi alterado o registro;N;S;S;S.
- PROD_ID_DEL (int) - CAMPO INDICATIVO DE EXCLUSAO;É preenchido com a chave da tabela quando o registro for excluído;N;S;S;S.
- PROD_TIPOSPED (varchar) - Tipo Item para SPED  Padrão 00 = Mercadoria para revenda.
- PROD_NOMENF (varchar) - Cadastro do nome fiscal do produto que sai na nota, independente da descrição do produto.
- PROD_NOMESITE (varchar) - Nome para ser utilizado quando houver integração com e-commerce.
- FORNIS_MD5 (varchar) - Campo MD5 para indicação de campo único entre itens + serviço REFERENTE A TABELA ARQACESSO.FORNECEDOR_ITENS_SERVICO.
- PROD_ID_FILIALGRUPO (int) - DADO EXCLUSIVO DO GRUPO EMPRESA;Campo usado para poder definir dados especificos para um grupo de empresasEste dado virá da tabela EMPRESA_AGRUPADOR=EMPA_ID;N;S;S;S.
- PROD_ID_FILIAL (int) - DADO EXCLUSIVO DA EMPRESA;Campo usado para poder definir um dado exclusivo de um empresaEste dado virá da tabela EMPRESA=EMP_ID;N;S;S;S.
- PRODG_IDGRUPO (int) - Agrupador.
- PRODG_IDSUBGRUPO (int) - Agrupador.
- PRODG_IDLINHA (int) - Agrupador.
- PRODG_IDSEGMENTACAO (int) - Agrupador.
- PRODG_IDINDICE (int) - Indice, 1.49 1.56 etc - agrupador.
- PROD_STSUPERFLUO (char) - Determina se o produto é superfluo, fundo combate pobreza S Sim N para não.
- PROD_STCATALOGO (char) - Se o produto ira para o catalogo ou não.
- PROD_DSCATALOGO (varchar) - Descrição que será usada dentro catalogo, assume nome do produto quando vaziu.
- PROD_VOLUME (decimal) - Volume total, calculado: largura * altura * comprimento.
- GTIN_ID (int) - Tipo codito de barras, vem do arqacesso. Padrão para todo mundo..
- PRODG_IDTIPOINTERNO (int) - Tipo interno 1 = NENHUM 2 = METAL PRECIOSO 3 = METAL PRECIOSO + PEDRA 4 = LENTE 5 = ARMACAO 6 = LENTE DE CONTATO.
- PROD_ORIGEM (int) - Procedencia: 0 = Nacional, exceto as indicadas nos codigos 3, 4, 5 e 8      1 = Estrangeira - Importacao direta, exceto a indicada no codigo 6      2 = Estrangeira - Adquirida no mercado interno, exceto a indicada no codigo 7      3 = Nacional, mercadoria ou bem com Conteudo de Importacao superior a 40% e inferior ou igual a 70%      4 = Nacional, cuja producao tenha sido feita em conformidade com os processos produtivos basicos de que tratam as legislacoes citadas nos Ajustes      5 = Nacional, mercadoria ou bem com Conteudo de Importacao inferior ou igual a 40%      6 = Estrangeira - Importacao direta, sem similar nacional, constante em lista da CAMEX e gas natural      7 = Estrangeira - Adquirida no mercado interno, sem similar nacional, constante lista CAMEX e gas natural      8 = Nacional, mercadoria ou bem com Conteudo de Importacao superior a 70%.
- PROD_NFSEGRUPOSERV (varchar) - É o GRUPO do serviço Usado para compor a tag ItemListaServico na nota de serviço..
- PROD_NFSEESPECIESERV (varchar) - É a ESPÉCIE do serviço Usado para compor a tag ItemListaServico na nota de serviço..
- PROD_NFSECODCNAE (varchar) - Código CNAE Usado na nota de serviço..
- PROD_NFSEALIQUOTA (decimal) - Nota de serviço: Alíquota.
- PROD_NFSEIR (decimal) - Nota de serviço: % de IR.
- PROD_NFSECSLL (decimal) - Nota de serviço: % de CSLL.
- PROD_NFSEINSS (decimal) - Nota de serviço: % de INSS.
- PROD_NFSECOFINS (decimal) - Nota de serviço: % de COFINS.
- PROD_NFSEPIS (decimal) - Nota de serviço: % de PIS.
- PROD_NFSEOUTRASRETENCOES (decimal) - Nota de serviço: % de OUTRAS RETENÇÕES.
- PROD_NFSEDEDUCOES (decimal) - Nota de serviço: % de DEDUÇÕES.
- PROD_NFSECODTRIBMUNICIPIO (varchar) - Nota de Serviço: Código de tributação no município.
- PROD_ID_ANTIGO (varchar) - Armazena o codigo proveniente de importacao de dados.
- PROD_STSITE (char) - Indica se o produto irá aparecer no site ou não N = NAO INTEGRADO P = PUBLICAR E = PENDENTE I = INATIVAR ENVIO.
- PROD_DESCRICAOSITE (varchar) - Descritivo do produto que irá aparecer no site.
- PROD_IDPAISITE (int) - Campo indicativo para indicar os filhos de um produto pai EX:  Armacao X Blue = pai Armacao X Amarela = filho Armacao X Vermelha = filho  No site só deve aparecer o item pai e quando o cliente clica irá aparecer demais detalhe como cor Amarela, Vermelha.
- PROD_STVNDA (char) - Indica se o produto está integrado com a plataforma VNDA  S = sim N = não.
- PROD_NOMESITEVNDA (varchar) - Nome do produto que irá para aparecer na plataforma VNDA.
- PROD_DESCRICAOSITEVNDA (varchar) - Descrição do produto que irá para aparecer na plataforma VNDA.
- PROD_IDVNDA (bigint) - Campo que indica o De\PARA entre o site da VNDA e a plataforma RB de produto  Esse campo é vinculado quando ocorre um POST na plataoforma VNDA indicando o seu código gerado.
- PROD_STKIT (char) - Indica se o produto compõe um KIT S = SIM N = NAO.
- PROD_STDESCRICAOSITEVNDA (char) - Indica se irei enviar os dados descritivo para a integração VNDA ou não  S = Sim, enviar N= Não.
- PROD_FATORCUBAGEM (decimal) - Permite armazenar p fator de cubagem para permitir a geração do frete de forma correta.
- PROD_PESOKGCUBAGEM (decimal) - NULL.
- PRODG_IDREFERENCIA (int) - Código da referência.
- PRODG_IDCATEGORIA (int) - Código da Classificação.
- PROD_TPORIGEM (tinyint) - Indica a origem do produto sendo: 1 = RB 2 = importação 4 - visiolens 5 = getab 6 - importação CSV.
- PROD_NFSECODSERV (varchar) - NULL.
- PROD_NOMEREDUZIDO (varchar) - Nome reduzido do produto..
- PROD_CODIGOSGO (int) - Armazena o código de integração para DE X Para com o sistema SGO.
- PROD_QTDEDIASENTREGA (int) - Armazena a quantidade de dias previsto para entrega. O sistema sermpre irá sugerior a data final com base na maior quantidade.
- PROD_ARMACAO_TIPO (int) - Tipo da armação.
- PROD_TPMODELO (tinyint) - Modelo do Desenho da armação.
- PROD_DP (decimal) - DP.
- PROD_PONTE (decimal) - Ponte.
- PROD_ARO (decimal) - Aro.
- PROD_MAIOR_DIAGONAL (decimal) - Maior diagonal.
- PROD_MAIOR_VERTICAL (decimal) - Maior vertical.
- PROD_QTDEFUROS (decimal) - Quantidade de furos.
- PROD_MAIOR_RAIO (decimal) - Medida do > Raio da Lente. Medido a partir do menor DNP até a borda da lente..
- PROD_HASTE (decimal) - Medida da haste.
- PROD_DESCRICAO (varchar) - Descrição do produto.
- PROD_DISP_INDICE (decimal) - Disponibilidade de lentes - Índice.
- PROD_DISP_ESFERICO_INICIAL (decimal) - Disponibilidade de lentes - Valor mínimo para esférico.
- PROD_DISP_ESFERICO_FINAL (decimal) - Disponibilidade de lentes - Valor maximo para esférico.
- PROD_DISP_CILINDRICO_INICIAL (decimal) - Disponibilidade de lentes - Valor mínimo para cilíndrico.
- PROD_DISP_CILINDRICO_FINAL (decimal) - Disponibilidade de lentes - Valor maximo para cilíndrico.
- PROD_DISP_ADICAO_INICIAL (decimal) - Disponibilidade de lentes - Valor mínimo para adição.
- PROD_DISP_ADICAO_FINAL (decimal) - Disponibilidade de lentes - Valor maximo para adição.
- PROD_DISP_FORCAMAIOR (decimal) - Disponibilidade de lentes - Força Maior (Valor máximo da soma de esférico e cilíndrico quando negativos).
- PROD_STVTONDESTAQUE (char) - No vton irá indicar se o produto\serviço irá para a primeira página ou não SIM = S (primeira pagina) NAO=N.
- PROD_NMIND (varchar) - NULL.

Tabela: PRODUTO_GRUPO
Descricao: Estrutura da tabela PRODUTO_GRUPO no dominio Produtos.
Colunas:
- PRODG_ID (int) - CHAVE;Campo único na tabela;S;1;1;0. (PK) (NOT NULL)
- PRODG_CODIGO (int) - CODIGO; campo que permite armazenar um contador que será geranciado pelo sistema, irá facilitar a migração de sistemas, permitindo manter o código original  1 - Não definido Campo Default que não poderá ser excluído ou muito menos inativado;S;1;1;0.
- PRODG_NOME (varchar) - NOME;Nome do agrupador;S;1;1;0.
- PRODG_TIPO (tinyint) - Armazena os tipos de agrupamentos disponiveis O Sistema poderá ter infinitos agrupamentos o padrão será:  1 - Grupo 2 - SubGrupo 3 - Linha 4 - Segmentação 5 - Marca 6 - Genero 7 - Tamanho 8 - Material 9 - Indice 10 - Cor 11 - Fabricante 12 - Localização 13 - Tipo Armação 14 - Referência 15 - Categoria.
- PRODG_ID_DEL (int) - CAMPO INDICATIVO DE EXCLUSAO;É preenchido com a chave da tabela quando o registro for excluído;N;S;S;S.
- PRODG_DTUSUCRIOU (datetime) - DATA CRIACAO REGISTRO;Armazena a data em que foi criado o registro;N;S;S;S.
- PRODG_NMUSUCRIOU (varchar) - USUARIO CRIOU REGISTRO;Armazena o usuário que criou o registro;N;S;S;S.
- PRODG_DTUSUALT (datetime) - DATA ALTERACAO REGISTRO;Armazena a última data em que foi alterado o registro;N;S;S;S.
- PRODG_NMUSUALT (varchar) - USUARIO ALTEROU REGISTRO;Armazena o último usuário em que foi alterado o registro;N;S;S;S.
- PRODG_STATUS (char) - STATUS DO REGISTRO;Indica se o registro está ativo=S ou não ativo=N;N;S;S;N.
- PRODG_ID_FILIALGRUPO (int) - DADO EXCLUSIVO DO GRUPO EMPRESA;Campo usado para poder definir dados especificos para um grupo de empresasEste dado virá da tabela EMPRESA_AGRUPADOR=EMPA_ID;N;S;S;S.
- PRODG_ID_FILIAL (int) - DADO EXCLUSIVO DA EMPRESA;Campo usado para poder definir um dado exclusivo de um empresaEste dado virá da tabela EMPRESA=EMP_ID;N;S;S;S.
- PRODG_NOMESITE (varchar) - NULL.
- PRODG_TPARMACAOACERT (varchar) - Tipo da armação de acordo com a Acert. Exemplo: ACERT : RB : SIGLA NO NO BANCO DE DADOS   / Tipos: Não Definido : NDF  / FULL_RIM_PLASTIC_STRONG : Aro fechado plástico duro : FRPS  / FULL_RIM_PLASTIC_FLEXIBLE : Aro fechado plástico flexível : FRPF  / FULL_RIM_PLASTIC_METAL : Aro fechado plástico com metal (ou só metal) : FRPM  / RIMLESS : Três peças / Balgrif / Parafuso : RIM  / NYLON : Fio de nylon : NYL.
- PRODG_STKIT (char) - Indica se o grupo compõe um KIT S = SIM N = NAO.
- PRODG_STREPOSICAOAUTOMATICA (char) - Indica se o grupo deve ser filtrado no módulo Reposição de Compra. S = SIM, N = NAO.
- PRODG_STBLOQUEARINSERCAOVENDA (char) - Bloqueia a insersão dos produtos vinculados ao grupo de forma individual na venda, ou seja, só permite inserir vinculando na prescrição como lente ou armação. S = SIM N = NÃO.
- PRODG_STINDUSTRIALIZAR (char) - NULL.
- PRODG_STIND (char) - NULL.

Tabela: PRODUTO_TABVALOR_ITEM
Descricao: Estrutura da tabela PRODUTO_TABVALOR_ITEM no dominio Produtos.
Colunas:
- PRODTI_ID (int) - Armazena a chave tabela. (PK) (NOT NULL)
- PRODTV_ID (int) - Armazena a chave tabela cabeçalho. (FK -> PRODUTO_TABVALOR.PRODTV_ID)
- PROD_ID (int) - Armazena a chave vinculo produto. (FK -> PRODUTO.PROD_ID)
- PRODTI_VLVENDA (decimal) - Valor aplicado para o produto nesta tabela.
- EMP_ID (int) - NULL.
- PRODTI_DTUSUCRIOU (datetime) - Data de criação interna do sistema.
- PRODTI_NMUSUCRIOU (varchar) - Nome de quem criou.
- PRODTI_DTUSUALT (datetime) - Data de alteração.
- PRODTI_NMUSUALT (varchar) - Nome de quem alterou.
- PRODTI_ID_DEL (int) - Codigo exclusão.
- PRODTI_ID_FILIALGRUPO (int) - DADO EXCLUSIVO DO GRUPO EMPRESA;Campo usado para poder definir dados especificos para um grupo de empresasEste dado virá da tabela EMPRESA_AGRUPADOR=EMPA_ID;N;S;S;S.
- PRODTI_ID_FILIAL (int) - DADO EXCLUSIVO DA EMPRESA;Campo usado para poder definir um dado exclusivo de um empresaEste dado virá da tabela EMPRESA=EMP_ID;N;S;S;S.
- PRODTI_CTLIQUIDO (decimal) - Valor de Custo Líquido do Produto.
Regra Critica de Relacionamentos (JOINs):
- Para relacionar PRODUTO_TABVALOR_ITEM com PRODUTO_TABVALOR, use: LEFT JOIN PRODUTO_TABVALOR ON PRODUTO_TABVALOR.PRODTV_ID = PRODUTO_TABVALOR_ITEM.PRODTV_ID
- Para relacionar PRODUTO_TABVALOR_ITEM com PRODUTO, use: LEFT JOIN PRODUTO ON PRODUTO.PROD_ID = PRODUTO_TABVALOR_ITEM.PROD_ID

Tabela: PRODUTO_TIPOITEM
Descricao: Estrutura da tabela PRODUTO_TIPOITEM no dominio Produtos.
Colunas:
- PRODT_ID (int) - Campo auto incremento da tabela. (NOT NULL)
- PRODT_CODIGO (varchar) - Código do produto, que também é a chave primária da tabela. (PK) (NOT NULL)
- PRODT_NOME (varchar) - Descrição do tipo.
- PRODT_DTUSUCRIOU (datetime) - DATA CRIACAO REGISTRO;Armazena a data em que foi criado o registro;N;S;S;S.
- PRODT_NMUSUCRIOU (varchar) - USUARIO CRIOU REGISTRO;Armazena o usuário que criou o registro;N;S;S;S.
- PRODT_ID_DEL (int) - CAMPO INDICATIVO DE EXCLUSAO;É preenchido com a chave da tabela quando o registro for excluído;N;S;S;S.
- PRODT_DTUSUALT (datetime) - DATA ALTERACAO REGISTRO;Armazena a última data em que foi alterado o registro;N;S;S;S.
- PRODT_NMUSUALT (varchar) - USUARIO ALTEROU REGISTRO;Armazena o último usuário em que foi alterado o registro;N;S;S;S.
- PRODT_ID_FILIALGRUPO (int) - DADO EXCLUSIVO DO GRUPO EMPRESA;Campo usado para poder definir dados especificos para um grupo de empresasEste dado virá da tabela EMPRESA_AGRUPADOR=EMPA_ID;N;S;S;S.
- PRODT_ID_FILIAL (int) - DADO EXCLUSIVO DA EMPRESA;Campo usado para poder definir um dado exclusivo de um empresaEste dado virá da tabela EMPRESA=EMP_ID;N;S;S;S.
- PRODT_STVENDA (char) - Permite ou não que produtos vinculados ao tipo possão ser inseridos no atendimento.

Regra Global:
- A tabela PRODUTO NAO possui o campo EMP_ID. Nunca adicione 'EMP_ID = 1' como filtro em queries que usam apenas PRODUTO.
- Para filtrar apenas registros ATIVOS em PRODUTO, sempre adicione: PROD_ID_DEL IS NULL
- PRODUTO_GRUPO tambem NAO possuis EMP_ID diretamente; use os campos PRODG_ID_FILIAL ou PRODG_ID_FILIALGRUPO se necessario mas nunca EMP_ID.
- Apenas PRODUTO_TABVALOR_ITEM possui EMP_ID. Se EMP_ID for necessario (quando especificado), aplique somente nas tabelas que realmente possuem esse campo.
- Mantenha a logica de banco de dados padrao.
`;
