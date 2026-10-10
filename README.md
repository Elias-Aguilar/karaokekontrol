# Karaoke en red local

Los invitados cargan enlaces de YouTube desde el celular. El visor, en el televisor, los reproduce por turnos.

## Arranque

```bash
npm install
npm start
```

El servidor escucha en el puerto **8082**. Desde otro dispositivo de la misma red:

- Invitados: `http://192.168.x.x:8082/invitados`
- Visor: `http://192.168.x.x:8082/visor`
- Admin: `http://192.168.x.x:8082/admin`

Abrí el visor **una sola vez**, en la pantalla de la fiesta. El primer toque en «Iniciar» habilita el audio; después las canciones se encadenan solas.

## Admin

PIN inicial: `karaoke`. Se cambia desde el panel.

Ahí se ajusta el máximo de canciones por invitado, cuántas suenan por turno (nunca más que ese máximo), los segundos de «Prepárate», el orden de la ronda y las canciones cargadas.

## Datos

Todo queda en `data/karaoke.db`. No se descargan videos: se guarda el enlace y se reproduce con el reproductor oficial de YouTube. El equipo del visor necesita internet.
