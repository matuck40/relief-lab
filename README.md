# Relief Lab

Protótipo local-first para transformar um único SVG multicor em um projeto 2,5D organizado por níveis de relevo e preparado para exportação 3MF.

## Primeira fatia implementada

- interface de preparação do projeto;
- upload local de SVG;
- contagem de formas vetoriais simples;
- detecção inicial de cores de preenchimento;
- estrutura visual de níveis e alturas acumuladas;
- prévia conceitual da peça;
- layout responsivo.

## Próximo marco técnico

1. criar um modelo de dados estável para formas, cores e níveis;
2. renderizar o SVG real com seleção por forma;
3. permitir atribuir cada forma a um nível;
4. gerar geometrias extrudadas;
5. validar exportação 3MF em Bambu Studio e OrcaSlicer.

## Desenvolvimento local

```bash
npm run dev
```

## Validação

```bash
npm run build
```
