// Material Maker's previews for 3D outputs (preview_<type>.gdshader, MIT): a lit 3D shape or a ball with the
// 3D texture on it, shown from the front. They are pictures of a 3D thing, so they don't tile.
export const PREVIEW_3D: Record<string, string> = {
  sdf3d: `float calcdist(vec3 uv) {
	float _seed_variation_ = variation;
	vec4 _controlled_variation_ = vec4(0.0);
	$(code)
	float v = $(value);
	v = v == 0.0 ? 1.0 : v;
	return min($(value), uv.z);
}

float raymarch(vec3 ro, vec3 rd) {
	float d=0.0;
	for (int i = 0; i < 50; i++) {
		vec3 p = ro + rd*d;
		float dstep = calcdist(p);
		d += dstep;
		if (abs(dstep) < 0.001) break;
	}
	return d;
}
vec3 normal(vec3 p) {
	float d = calcdist(p);
    float e = .0001;
    vec3 n = d - vec3(calcdist(p-vec3(e, 0.0, 0.0)), calcdist(p-vec3(0.0, e, 0.0)), calcdist(p-vec3(0.0, 0.0, e)));
    return normalize(n);
}

vec4 preview_2d(vec2 uv) {
	uv -= vec2(0.5);
	vec3 p = vec3(uv, 2.0-raymarch(vec3(uv, 2.0), vec3(0.0, 0.0, -1.0)));
	vec3 n = normal(p);
	vec3 l = vec3(5.0, 5.0, 10.0);
	vec3 ld = normalize(l-p);
	float o = step(p.z, 0.001);
	float shadow = 1.0-0.75*step(raymarch(l, -ld), length(l-p)-0.01);
	float light = 0.3+0.7*dot(n, ld)*shadow;
	return vec4(vec3(0.8+0.2*o, 0.8+0.2*o, 1.0)*light, 1.0);
}
`,
  sdf3dc: `vec2 calcdist(vec3 uv) {
	float _seed_variation_ = variation;
	vec4 _controlled_variation_ = vec4(0.0);
	$(code)
	vec2 v = $(value);
	v.x = v.x == 0.0 ? 1.0 : v.x;
	return vec2(min(v.x, uv.z), v.y);
}

vec2 raymarch(vec3 ro, vec3 rd) {
	float d=0.0;
	float color;
	for (int i = 0; i < 50; i++) {
		vec3 p = ro + rd*d;
		vec2 dstep = calcdist(p);
		d += dstep.x;
		if (abs(dstep.x) < 0.001) {
			color = dstep.y;
			break;
		}
	}
	return vec2(d, color);
}
vec3 normal(vec3 p) {
	float d = calcdist(p).x;
    float e = .0001;
    vec3 n = d - vec3(calcdist(p-vec3(e, 0.0, 0.0)).x, calcdist(p-vec3(0.0, e, 0.0)).x, calcdist(p-vec3(0.0, 0.0, e)).x);
    return normalize(n);
}

vec3 rm_color(float c) {
	vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
	vec3 p = abs(fract(vec3(c) + K.xyz) * 6.0 - K.www);
	return 1.0 * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), 1.0);
}

vec4 preview_2d(vec2 uv) {
	uv -= vec2(0.5);
	vec2 rm = raymarch(vec3(uv, 2.0), vec3(0.0, 0.0, -1.0));
	vec3 p = vec3(uv, 2.0-rm.x);
	vec3 n = normal(p);
	vec3 l = vec3(5.0, 5.0, 10.0);
	vec3 ld = normalize(l-p);
	float o = step(p.z, 0.001);
	float shadow = 1.0-0.75*step(raymarch(l, -ld).x, length(l-p)-0.01);
	float light = 0.3+0.7*dot(n, ld)*shadow;
	return vec4(mix(rm_color(fract(rm.y)), vec3(0.9), o)*light, 1.0);
}
`,
  tex3d: `float calcdist(vec3 p) {
    return length(p)-0.4;
}

vec3 calcColor(vec4 uv) {
    float _seed_variation_ = variation;
	vec4 _controlled_variation_ = vec4(0.0);
	$(code)
    return $(value);
}

float raymarch(vec3 ro, vec3 rd) {
    float d=0.0;
    for (int i = 0; i < 200; i++) {
        vec3 p = ro + rd*d;
        float dstep = calcdist(p);
        d += dstep;
        if (dstep < 0.0001) break;
    }
    return d;
}
vec3 normal(vec3 p) {
    float d = calcdist(p);
    float e = .0001;
    vec3 n = d - vec3(calcdist(p-vec3(e, 0.0, 0.0)), calcdist(p-vec3(0.0, e, 0.0)), calcdist(p-vec3(0.0, 0.0, e)));
    return normalize(n);
}

vec4 preview_2d(vec2 uv) {
    uv -= vec2(0.5);
    vec3 p = vec3(uv, 2.0-raymarch(vec3(uv, 2.0), vec3(0.0, 0.0, -1.0)));
    // EGD: outside the ball is black (the ray runs off to infinity there; Godot shows the NaN as black, WebGL keeps it)
    if (!(p.z >= 0.001)) return vec4(0.0, 0.0, 0.0, 1.0);
    vec3 n = normal(p);
    vec3 l = vec3(5.0, 5.0, 10.0);
    vec3 ld = normalize(l-p);
    float o = step(p.z, 0.001);
    float shadow = 1.0-0.75*step(raymarch(l, -ld), length(l-p)-0.01);
    float light = 0.3+0.7*dot(n, ld)*shadow;
    return vec4(calcColor(vec4(p, 0.0))*light-o, 1.0);
}
`,
  tex3d_gs: `float calcdist(vec3 p) {
    return length(p)-0.4;
}

vec3 calcColor(vec4 uv) {
    float _seed_variation_ = variation;
	vec4 _controlled_variation_ = vec4(0.0);
	$(code)
    return vec3($(value));
}

float raymarch(vec3 ro, vec3 rd) {
    float d=0.0;
    for (int i = 0; i < 200; i++) {
        vec3 p = ro + rd*d;
        float dstep = calcdist(p);
        d += dstep;
        if (dstep < 0.0001) break;
    }
    return d;
}
vec3 normal(vec3 p) {
    float d = calcdist(p);
    float e = .0001;
    vec3 n = d - vec3(calcdist(p-vec3(e, 0.0, 0.0)), calcdist(p-vec3(0.0, e, 0.0)), calcdist(p-vec3(0.0, 0.0, e)));
    return normalize(n);
}

vec4 preview_2d(vec2 uv) {
    uv -= vec2(0.5);
    vec3 p = vec3(uv, 2.0-raymarch(vec3(uv, 2.0), vec3(0.0, 0.0, -1.0)));
    // EGD: outside the ball is black (the ray runs off to infinity there; Godot shows the NaN as black, WebGL keeps it)
    if (!(p.z >= 0.001)) return vec4(0.0, 0.0, 0.0, 1.0);
    vec3 n = normal(p);
    vec3 l = vec3(5.0, 5.0, 10.0);
    vec3 ld = normalize(l-p);
    float o = step(p.z, 0.001);
    float shadow = 1.0-0.75*step(raymarch(l, -ld), length(l-p)-0.01);
    float light = 0.3+0.7*dot(n, ld)*shadow;
    return vec4(calcColor(vec4(p, 0.0))*light-o, 1.0);
}
`,
  v4v4: `vec4 mfield(vec4 uv) {
	float _seed_variation_ = variation;
	vec4 _controlled_variation_ = vec4(0.0);
	$(code)
	return $(value);
}

float raymarch(vec3 ro, vec3 rd) {
    float d=0.0;
    for (int i = 0; i < 200; i++) {
        vec3 p = ro + rd*d;
        float dstep = mfield(vec4(p,0.0)).w;
        d += dstep;
        if (dstep < 0.0001) break;
    }
    return d;
}
vec3 normal(vec3 p) {
    float d = mfield(vec4(p,0.0)).w;
    float e = .0001;
    vec3 n = d - vec3(mfield(vec4(p-vec3(e, 0.0, 0.0),0.0)).w, mfield(vec4(p-vec3(0.0, e, 0.0),0.0)).w, mfield(vec4(p-vec3(0.0, 0.0, e),0.0)).w);
    return normalize(n);
}

vec4 preview_2d(vec2 uv) {
    uv -= vec2(0.5);
    vec3 p = vec3(uv, 2.0-raymarch(vec3(uv, 2.0), vec3(0.0, 0.0, -1.0)));
    vec3 n = normal(p);
    vec3 l = vec3(5.0, 5.0, 10.0);
    vec3 ld = normalize(l-p);
    float o = step(p.z, 0.001);
    float shadow = 1.0-0.75*step(raymarch(l, -ld), length(l-p)-0.01);
    float light = 0.3+0.7*dot(n, ld)*shadow;
    return vec4(mfield(vec4(p, 1.0)).xyz*light, 1.0);
}
`,
}
