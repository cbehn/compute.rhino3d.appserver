const fs = require('fs');
const rhino3dm = require('rhino3dm')();

rhino3dm.then(rhino => {
    const data = JSON.parse(fs.readFileSync('populus 500 eroror but solve.json', 'utf8'));
    data.values.forEach(val => {
        if (val.ParamName.includes('Thin') || val.ParamName.includes('GFRC') || val.ParamName.includes('surface')) {
            console.log("Found:", val.ParamName);
            const tree = val.InnerTree;
            Object.values(tree).forEach(branch => {
                branch.forEach(chunk => {
                    const parsed = JSON.parse(chunk.data);
                    const ro = rhino.CommonObject.decode(parsed);
                    if (ro instanceof rhino.Brep) {
                        console.log("Is Brep. Faces:", ro.faces().count);
                        const faces = ro.faces();
                        let hasMesh = false;
                        for (let i = 0; i < faces.count; i++) {
                            const face = faces.get(i);
                            const mesh = face.getMesh(rhino.MeshType.Any);
                            if (mesh) {
                                hasMesh = true;
                                console.log("Face", i, "has mesh");
                                mesh.delete();
                            }
                            face.delete();
                        }
                        console.log("Has mesh?", hasMesh);
                    }
                });
            });
        }
    });
}).catch(e => console.error(e));
