#### Proyeto base para proyectos tddlab:

#### Creado a partir de proyecto usado en IngSoftware: parcel-jest-base

https://github.com/israelantezana/parcel-jest-base

#### Comandos creados en package json:

#### Para instalar las dependencias:

npm install

#### Comandos de uso:

Ejecutar web-sever local parcel:
npm start

Ejecutar una corrida de pruebas de unidad:
npm test

### Registro en la API de TDDLab

Con Node.js 20 o superior y un `origin` de GitHub, configura la URL del servidor en cada proyecto:

```sh
npm install
git config --local tddlab.apiUrl http://localhost:3000/api/branchSupport
npm run tddlab:register
```

También puedes definir `TDDLAB_API_URL` en el entorno. Si la URL y `origin` ya están configurados al instalar, el proyecto se registra durante la instalación.

- `git branch` y `git switch -c` registran ramas nuevas. Si el registro de la rama aún falta, un commit o una ejecución lo resuelven al enviar sus datos.
- `git commit` y los merges registran el SHA y sus padres. En modo API, el hook conserva el SHA de Git.
- `npm test` guarda cada ejecución de Jest, incluidas las fallidas. Con el árbol limpio se enlaza al SHA probado. Una ejecución con cambios locales queda asociada a la rama, con SHA nulo.
- `npm run tddlab:register -- commit` permite volver a registrar el commit actual. Si falla el envío de una ejecución, su reporte queda en el directorio de Git, bajo `tddlab/unsent-tests/`. Antes de reenviarlo, comprueba si el servidor ya recibió la corrida.

Los proyectos sin URL configurada conservan el flujo de archivos JSON.
