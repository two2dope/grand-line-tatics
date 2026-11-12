# Grand Line Tactics — Relatório da Suíte de Simulação Headless

**Data / Hora:** 2026-11-12T23:57:04.076Z
**Total de Partidas Simuladas:** 200.000
**Tempo Total de Execução:** 471.33 s

## 1. Calibração de Eficiência de Busca (10x10 Clássica)

| Dificuldade | Disparos Médios | Faixa Alvo | Mín / Máx | Desvio Padrão | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **grumete** | 95.38 | 85.0 – 98.0 | 65 / 100 | ±4.82 | ✅ Aprovado |
| **marujo** | 56.12 | 55.0 – 70.0 | 28 / 79 | ±10.08 | ✅ Aprovado |
| **capitao** | 47.78 | Entre Marujo e Yonkou | 24 / 83 | ±8.15 | ✅ Aprovado |
| **yonkou** | 42.34 | 40.0 – 55.0 | 22 / 68 | ±7.5 | ✅ Aprovado |

## 2. Resumo da Matriz Completa (96 Combinações)

- **Posicionamentos 100% Válidos:** Sim (zero sobreposições e limites respeitados)
- **Terminação Limpa:** Sim (todas as partidas terminaram no prazo)
- **Recompensas Finitas e Consistentes:** Sim (todas >= ฿ 10.000.000)
- **Determinismo de Semente:** Sim (100% reprodutível)
- **Taxa de Vitória P1 vs P2 (IAs Iguais):** P1: 49.1% | P2: 50.9%
- **Turnos Médios Globais:** 116.90

## 3. Tabela Detalhada por Combinação (Amostra Resumida)

| Tabuleiro | Modo | Mar | Dificuldade | P1 Win% | Turnos Médios | Disparos Vencedor | Recompensa Média |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| escaramuca | classico | mar_calmo | grumete | 49.9% | 115.21 | 57.88 | ฿ 207.061.125 |
| escaramuca | classico | grand_line | grumete | 51.1% | 115.2 | 57.87 | ฿ 207.001.210 |
| escaramuca | classico | novo_mundo | grumete | 51.9% | 115.11 | 57.83 | ฿ 207.263.585 |
| escaramuca | classico | tempestade | grumete | 47.8% | 115.62 | 58.08 | ฿ 206.900.475 |
| escaramuca | tatico | mar_calmo | grumete | 50.7% | 115.01 | 57.78 | ฿ 249.163.930 |
| escaramuca | tatico | grand_line | grumete | 50.3% | 115 | 57.77 | ฿ 249.470.865 |
| escaramuca | tatico | novo_mundo | grumete | 49.2% | 115.27 | 57.91 | ฿ 249.108.275 |
| escaramuca | tatico | tempestade | grumete | 50.5% | 115.69 | 58.13 | ฿ 248.225.095 |
| classica | classico | mar_calmo | grumete | 49.0% | 185.39 | 92.98 | ฿ 283.565.475 |
| classica | classico | grand_line | grumete | 50.3% | 185.35 | 92.96 | ฿ 283.411.415 |
| classica | classico | novo_mundo | grumete | 47.2% | 185.1 | 92.82 | ฿ 283.782.900 |
| classica | classico | tempestade | grumete | 50.3% | 185.38 | 92.95 | ฿ 283.281.095 |
| classica | tatico | mar_calmo | grumete | 51.1% | 185.29 | 92.92 | ฿ 339.776.855 |
| classica | tatico | grand_line | grumete | 50.6% | 185.83 | 93.19 | ฿ 338.843.230 |
| classica | tatico | novo_mundo | grumete | 48.0% | 185.32 | 92.93 | ฿ 340.469.035 |
| classica | tatico | tempestade | grumete | 48.9% | 185.13 | 92.84 | ฿ 340.618.995 |
| grand_line | classico | mar_calmo | grumete | 50.4% | 273.07 | 136.81 | ฿ 448.283.725 |
| grand_line | classico | grand_line | grumete | 49.5% | 272.37 | 136.45 | ฿ 448.728.685 |
| grand_line | classico | novo_mundo | grumete | 49.0% | 272.64 | 136.59 | ฿ 448.934.300 |
| grand_line | classico | tempestade | grumete | 49.8% | 273.09 | 136.81 | ฿ 448.092.280 |
| grand_line | tatico | mar_calmo | grumete | 49.8% | 273.01 | 136.77 | ฿ 537.981.380 |
| grand_line | tatico | grand_line | grumete | 50.4% | 272.97 | 136.76 | ฿ 538.795.675 |
| grand_line | tatico | novo_mundo | grumete | 50.9% | 272.98 | 136.77 | ฿ 538.871.645 |
| grand_line | tatico | tempestade | grumete | 51.1% | 272.49 | 136.51 | ฿ 539.463.640 |
| escaramuca | classico | mar_calmo | marujo | 49.9% | 65.31 | 32.93 | ฿ 416.387.550 |
| escaramuca | classico | grand_line | marujo | 50.5% | 65.73 | 33.13 | ฿ 414.162.250 |
| escaramuca | classico | novo_mundo | marujo | 50.9% | 65.45 | 33 | ฿ 415.967.100 |
| escaramuca | classico | tempestade | marujo | 50.7% | 65.31 | 32.93 | ฿ 415.324.235 |
| escaramuca | tatico | mar_calmo | marujo | 51.1% | 65.47 | 32.99 | ฿ 498.429.760 |
| escaramuca | tatico | grand_line | marujo | 50.9% | 65.74 | 33.13 | ฿ 497.864.460 |
| escaramuca | tatico | novo_mundo | marujo | 49.2% | 65.46 | 32.99 | ฿ 498.387.445 |
| escaramuca | tatico | tempestade | marujo | 50.0% | 65.89 | 33.21 | ฿ 496.812.060 |
| classica | classico | mar_calmo | marujo | 50.0% | 100.22 | 50.37 | ฿ 584.919.085 |
| classica | classico | grand_line | marujo | 48.4% | 100.61 | 50.56 | ฿ 584.430.205 |
| classica | classico | novo_mundo | marujo | 50.2% | 100.98 | 50.75 | ฿ 584.183.640 |
| classica | classico | tempestade | marujo | 50.1% | 100.03 | 50.27 | ฿ 587.179.540 |
| classica | tatico | mar_calmo | marujo | 51.4% | 100.54 | 50.53 | ฿ 700.615.960 |
| classica | tatico | grand_line | marujo | 50.7% | 101.23 | 50.87 | ฿ 700.232.900 |
| classica | tatico | novo_mundo | marujo | 50.3% | 100.92 | 50.72 | ฿ 701.498.830 |
| classica | tatico | tempestade | marujo | 50.1% | 99.99 | 50.24 | ฿ 703.347.175 |
| grand_line | classico | mar_calmo | marujo | 51.0% | 153.9 | 77.21 | ฿ 877.445.485 |
| grand_line | classico | grand_line | marujo | 47.8% | 152.83 | 76.67 | ฿ 878.666.245 |
| grand_line | classico | novo_mundo | marujo | 49.9% | 153.15 | 76.83 | ฿ 880.133.560 |
| grand_line | classico | tempestade | marujo | 50.6% | 153.57 | 77.05 | ฿ 879.545.655 |
| grand_line | tatico | mar_calmo | marujo | 50.0% | 152.27 | 76.39 | ฿ 1.057.654.090 |
| grand_line | tatico | grand_line | marujo | 50.4% | 152.75 | 76.63 | ฿ 1.057.973.660 |
| grand_line | tatico | novo_mundo | marujo | 50.2% | 152.41 | 76.46 | ฿ 1.057.748.175 |
| grand_line | tatico | tempestade | marujo | 50.3% | 153.28 | 76.9 | ฿ 1.053.591.935 |
| escaramuca | classico | mar_calmo | capitao | 51.0% | 55.24 | 27.89 | ฿ 659.843.880 |
| escaramuca | classico | grand_line | capitao | 53.1% | 55.1 | 27.81 | ฿ 661.699.560 |
| escaramuca | classico | novo_mundo | capitao | 51.0% | 55.16 | 27.85 | ฿ 663.167.975 |
| escaramuca | classico | tempestade | capitao | 52.3% | 55.09 | 27.81 | ฿ 658.754.885 |
| escaramuca | tatico | mar_calmo | capitao | 49.2% | 56.68 | 28.91 | ฿ 780.542.535 |
| escaramuca | tatico | grand_line | capitao | 48.7% | 56.99 | 29.07 | ฿ 777.591.350 |
| escaramuca | tatico | novo_mundo | capitao | 48.5% | 56.47 | 28.79 | ฿ 780.510.895 |
| escaramuca | tatico | tempestade | capitao | 48.4% | 57.03 | 29.03 | ฿ 777.246.240 |
| classica | classico | mar_calmo | capitao | 49.4% | 84.79 | 42.66 | ฿ 917.088.425 |
| classica | classico | grand_line | capitao | 51.0% | 85.21 | 42.87 | ฿ 917.070.105 |
| classica | classico | novo_mundo | capitao | 51.1% | 84.79 | 42.65 | ฿ 915.267.910 |
| classica | classico | tempestade | capitao | 50.8% | 85 | 42.75 | ฿ 916.199.120 |
| classica | tatico | mar_calmo | capitao | 44.8% | 86.44 | 43.64 | ฿ 1.090.020.175 |
| classica | tatico | grand_line | capitao | 44.7% | 87.5 | 44.14 | ฿ 1.091.417.490 |
| classica | tatico | novo_mundo | capitao | 45.3% | 87.04 | 43.94 | ฿ 1.088.082.780 |
| classica | tatico | tempestade | capitao | 46.6% | 87.07 | 44 | ฿ 1.084.959.130 |
| grand_line | classico | mar_calmo | capitao | 50.1% | 126.37 | 63.44 | ฿ 1.377.077.470 |
| grand_line | classico | grand_line | capitao | 49.1% | 125.93 | 63.22 | ฿ 1.382.485.100 |
| grand_line | classico | novo_mundo | capitao | 49.8% | 125.62 | 63.06 | ฿ 1.383.182.330 |
| grand_line | classico | tempestade | capitao | 52.6% | 126.24 | 63.37 | ฿ 1.382.230.825 |
| grand_line | tatico | mar_calmo | capitao | 46.3% | 129.09 | 64.98 | ฿ 1.637.756.565 |
| grand_line | tatico | grand_line | capitao | 45.5% | 129.75 | 65.3 | ฿ 1.637.349.530 |
| grand_line | tatico | novo_mundo | capitao | 46.0% | 129.25 | 65.06 | ฿ 1.639.995.910 |
| grand_line | tatico | tempestade | capitao | 45.2% | 128.43 | 64.59 | ฿ 1.648.126.725 |
| escaramuca | classico | mar_calmo | yonkou | 51.1% | 50.38 | 25.45 | ฿ 1.093.726.240 |
| escaramuca | classico | grand_line | yonkou | 50.4% | 50.27 | 25.4 | ฿ 1.100.434.075 |
| escaramuca | classico | novo_mundo | yonkou | 50.9% | 50.15 | 25.33 | ฿ 1.099.864.145 |
| escaramuca | classico | tempestade | yonkou | 49.2% | 50.3 | 25.42 | ฿ 1.093.908.705 |
| escaramuca | tatico | mar_calmo | yonkou | 47.0% | 51.89 | 26.42 | ฿ 1.294.959.305 |
| escaramuca | tatico | grand_line | yonkou | 48.3% | 52.36 | 26.68 | ฿ 1.287.161.085 |
| escaramuca | tatico | novo_mundo | yonkou | 47.3% | 51.95 | 26.49 | ฿ 1.288.148.740 |
| escaramuca | tatico | tempestade | yonkou | 46.3% | 52.09 | 26.52 | ฿ 1.293.559.070 |
| classica | classico | mar_calmo | yonkou | 48.6% | 75.04 | 37.77 | ฿ 1.537.425.405 |
| classica | classico | grand_line | yonkou | 49.0% | 75.21 | 37.86 | ฿ 1.533.001.070 |
| classica | classico | novo_mundo | yonkou | 48.8% | 75.57 | 38.03 | ฿ 1.532.899.520 |
| classica | classico | tempestade | yonkou | 48.8% | 75.91 | 38.21 | ฿ 1.526.635.890 |
| classica | tatico | mar_calmo | yonkou | 42.2% | 77.52 | 39.03 | ฿ 1.824.643.780 |
| classica | tatico | grand_line | yonkou | 42.8% | 77.68 | 39.15 | ฿ 1.806.934.295 |
| classica | tatico | novo_mundo | yonkou | 44.1% | 78.42 | 39.52 | ฿ 1.803.079.345 |
| classica | tatico | tempestade | yonkou | 44.6% | 77.51 | 39.14 | ฿ 1.811.690.060 |
| grand_line | classico | mar_calmo | yonkou | 49.9% | 111.56 | 56.04 | ฿ 2.294.227.140 |
| grand_line | classico | grand_line | yonkou | 51.5% | 111.78 | 56.15 | ฿ 2.295.767.125 |
| grand_line | classico | novo_mundo | yonkou | 50.1% | 111.55 | 56.04 | ฿ 2.292.198.620 |
| grand_line | classico | tempestade | yonkou | 49.8% | 111.58 | 56.04 | ฿ 2.296.976.890 |
| grand_line | tatico | mar_calmo | yonkou | 44.6% | 113.67 | 57.23 | ฿ 2.728.919.730 |
| grand_line | tatico | grand_line | yonkou | 45.6% | 114.42 | 57.6 | ฿ 2.728.980.795 |
| grand_line | tatico | novo_mundo | yonkou | 42.4% | 114.9 | 57.78 | ฿ 2.729.094.995 |
| grand_line | tatico | tempestade | yonkou | 42.2% | 114.22 | 57.46 | ฿ 2.728.475.060 |
