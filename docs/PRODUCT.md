# Escopo do produto

## Problema

Makers que produzem chaveiros, placas e souvenirs 2,5D multicolor precisam separar, exportar, importar, alinhar e empilhar manualmente elementos vetoriais sempre que alteram a arte.

## Regra central

- forma define a posição;
- cor define o material;
- nível define a altura em Z.

A mesma cor pode aparecer em níveis diferentes, e cores diferentes podem compartilhar o mesmo nível.

## MVP

O MVP recebe um único SVG, identifica formas e cores, permite atribuir níveis, mostra uma prévia e exporta partes alinhadas para um slicer.

O primeiro suporte será deliberadamente limitado a formas vetoriais e preenchimentos sólidos. Texturas, filtros, máscaras, gradientes e um editor vetorial completo ficam fora do primeiro marco.

## Critérios de sucesso

- o alinhamento X/Y é preservado;
- alturas acumuladas são calculadas automaticamente;
- o resultado abre com escala e Z corretos no slicer;
- refazer uma arte é mais rápido que o fluxo manual;
- usuários externos conseguem concluir projetos e voltam para criar outro.
